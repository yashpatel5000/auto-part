import axios from "axios";
import connectDB from "../../../db.js";
import { CURRENT_PARTS, partsEndpoint } from "../../../utils/constant.js";
import { deleteMedias } from "../../../utils/aws.js";
import downloadImage from "../../../utils/download-image.js";
import { shopifyGraphQLRequest } from "../../../utils/shopify-axios.js";
import {
  productCreate,
  createVariantQuery,
} from "../../../graphql/mutation.js";
import logger from "../../../utils/logger.js";
import { getLocation, getOptionId } from "../../../graphql/query.js";
import { config } from "../../../config.js";


const partsApiAuth = {
  username: config.PARTS_API_USER_NAME,
  password: config.PARTS_API_PASSWORD,
  user_token: config.PARTS_API_USER_TOKEN,
};

async function processImage(part) {
  const filePaths = [];

  const isCDNImage = (url) =>
    !url.includes("JPG") && !url.includes("JPEG") && !url.includes("PNG");

  const buildMediaObject = (source) => ({
    mediaContentType: "IMAGE",
    originalSource: source,
  });

  if (part.part_photo_gallery?.length) {
    part.part_photo_gallery = await Promise.all(
      part.part_photo_gallery.map(async (image) => {
        if (isCDNImage(image)) {
          return buildMediaObject(image);
        } else {
          const { fileName, filePath } = await downloadImage(image);
          filePaths.push(fileName);
          return buildMediaObject(filePath);
        }
      })
    );
  } else if (part.photo) {
    if (isCDNImage(part.photo)) {
      part.part_photo_gallery = [buildMediaObject(part.photo)];
    } else {
      const { fileName, filePath } = await downloadImage(part.photo);
      filePaths.push(fileName);
      part.part_photo_gallery = [buildMediaObject(filePath)];
    }
  }

  return { part, filePaths };
}

export async function insertDataIntoShopify() {
  try {
    const db = await connectDB();
    const limit = 100;
    const totalPages = Math.ceil(CURRENT_PARTS / limit);

    for (let page = 1; page <= totalPages; page++) {
      logger.info(`📥 Fetching products for page ${page}`);

      const formData = new URLSearchParams();
      formData.append("username", partsApiAuth.username);
      formData.append("password", partsApiAuth.password);
      formData.append("user_token", partsApiAuth.user_token);

      const response = await axios.post(partsEndpoint, formData, {
        params: { page, limit },
      });

      const allParts = response.data.data;

      for await (let part of allParts) {
        try {
          const exists = await db
            .collection("rrr-parts")
            .findOne({ id: part.id });

          if (exists) {
            logger.info(`ℹ️ Part ID ${part.id} already exists in Shopify.`);
            continue;
          }

          let imageProcessing = null;

          if (part?.part_photo_gallery?.length || part?.photo) {
            imageProcessing = await processImage(part);
            part = imageProcessing.part;
            logger.info(`📷 Media processed for Part ID ${part.id}`);
          }

          const carModelResponse = await axios.post(
            `https://api.rrr.lt/get/car/${part.car_id}`,
            formData
          );
          const car_model_id = carModelResponse.data.list[0][0].car_model;
          const car_models = await axios.post(
            "https://api.rrr.lt/get/car_models",
            formData
          );
          const carResponse = car_models.data.list.filter((model) => {
            return model.id === car_model_id.toString();
          });
          const brandNameResponse = await axios.post(
            "https://api.rrr.lt/get/car_brands",
            formData
          );
          const brandNames = brandNameResponse.data.list.filter((brand) => {
            return brand.id === carResponse[0].brand;
          });
          const partCategoriesResponse = await axios.post(
            "https://api.rrr.lt/get/categories",
            formData
          );
          const categories = partCategoriesResponse.data.list.filter(
            (category) => {
              return part.category_id === category.id;
            }
          );
          const metafields = [
            {
              namespace: "custom",
              key: "year",
              type: "single_line_text_field",
              value: `${carResponse[0].year_start}-${carResponse[0].year_end}`,
            },
            {
              namespace: "custom",
              key: "car",
              type: "single_line_text_field",
              value: brandNames[0].name,
            },
            {
              namespace: "custom",
              key: "part_number",
              type: "single_line_text_field",
              value: part.id,
            },
            {
              namespace: "custom",
              key: "model",
              type: "single_line_text_field",
              value: carResponse[0].name,
            },
            {
              namespace: "custom",
              key: "product_type",
              type: "single_line_text_field",
              value: categories[0].en,
            },
          ];
          const productInput = {
            input: {
              title: part.name || "No Title",
              descriptionHtml: part.notes || "No description",
              tags: ["parts"],
              metafields,
            },
            media: part.part_photo_gallery,
          };
          const productResponse = await shopifyGraphQLRequest({
            query: productCreate,
            variables: productInput,
          });

          const product = productResponse.data.data.productCreate.product;
          const productId = product.id;
          const locationResponse = await shopifyGraphQLRequest({
            query: getLocation(),
            variables: {},
          });
          const optionResponse = await shopifyGraphQLRequest({
            query: getOptionId(),
            variables: {
              id: product.id,
            },
          });

          const locationId =
            locationResponse.data.data.locations.edges[0].node.id;

          const variantInput = {
            productId,
            variants: [
              {
                price: part.original_price || part.price || "0.00",
                barcode: part.manufacturer_code || "",
                optionValues: [
                  {
                    optionId: optionResponse.data.data.product.options[0].id,
                    name: part.name,
                  },
                ],
                ...(part.status === "0" && {
                  inventoryQuantities: {
                    locationId,
                    availableQuantity: 100,
                  },
                }),
              },
            ],
          };

          const metafieldValues = metafields.reduce((acc, field) => {
            acc[field.key] = field.value;
            return acc;
          }, {});

          const variantResponse = await shopifyGraphQLRequest({
            query: createVariantQuery,
            variables: variantInput,
          });
          await db.collection("rrr-parts").insertOne(part);

          await db.collection("shopify-parts").insertOne({
            ...product,
            ...variantResponse.data.data.productVariantsBulkCreate
              .productVariants[0],
            rrr_partId: part.id,
            shopifyProductId: productId,
            metafields: metafieldValues,
          });

          if (imageProcessing?.filePaths) {
            await deleteMedias(imageProcessing.filePaths);
            logger.info(`🗑️ Media deleted from S3 for Part ID ${part.id}`);
          }

          logger.info(`✅ Part ID ${part.id} successfully stored in Shopify.`);
        } catch (error) {
          logger.error(`Unable to store part Id : ${part.id} into shopify.`);
          logger.error("Reason: ", JSON.stringify(error, null, 2));
          logger.error(error);
          continue;
        }
      }
    }
  } catch (err) {
    logger.error(`❌ API Error: ${err.message}`,err);
    throw err;
  }
}
