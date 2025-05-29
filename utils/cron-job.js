import connectDB from "../db.js";
import downloadImage from "./download-image.js";
import { getLocation, getOptionId } from "../graphql/query.js";
import {
  productCreate,
  createVariantQuery,
  productUpdate,
  updateVariantQuery,
  productDeleteMedia,
} from "../graphql/mutation.js";
import { shopifyGraphQLRequest } from "./shopify-axios.js";
import logger from "./logger.js";
import axios from "axios";
import { partsEndpoint } from "./constant.js";
import { deleteMedias } from "./aws.js";
import { config } from "../config.js";

const formData = new URLSearchParams();
formData.append("username", config.PARTS_API_USER_NAME);
formData.append("password", config.PARTS_API_PASSWORD);
formData.append("user_token", config.PARTS_API_USER_TOKEN);

const isCDNImage = (url) =>
  !url.includes("JPG") && !url.includes("JPEG") && !url.includes("PNG");

const buildMediaObject = (source) => ({
  mediaContentType: "IMAGE",
  originalSource: source,
});

async function processImage(part) {
  const filePaths = [];
  try {
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
  } catch (error) {
    logger.error(
      `Error processing images for Part ID ${part.id}: ${error.message}`
    );
    throw error;
  }

  return { part, filePaths };
}

async function fetchCarData(part) {
  try {
    const carModelResponse = await axios.post(
      `https://api.rrr.lt/get/car/${part.car_id}`,
      formData
    );
    const car_model_id = carModelResponse.data.list[0][0].car_model;

    const carModelsResponse = await axios.post(
      "https://api.rrr.lt/get/car_models",
      formData
    );
    const carResponse = carModelsResponse.data.list.find(
      (model) => model.id === car_model_id.toString()
    );

    const brandResponse = await axios.post(
      "https://api.rrr.lt/get/car_brands",
      formData
    );
    const brandNames = brandResponse.data.list.find(
      (brand) => brand.id === carResponse.brand
    );

    const categoriesResponse = await axios.post(
      "https://api.rrr.lt/get/categories",
      formData
    );
    const categories = categoriesResponse.data.list.find(
      (category) => category.id === part.category_id
    );

    return { carResponse, brandNames, categories };
  } catch (error) {
    logger.error(
      `Error fetching car data for Part ID ${part.id}: ${error.message}`
    );
    return {};
  }
}

const insertSinglePartToShopify = async (part, db) => {
  try {
    let imageProcessing = null;
    if (part?.part_photo_gallery?.length || part?.photo) {
      imageProcessing = await processImage(part);
      part = imageProcessing.part;
      logger.info(`📷 Media processed for Part ID ${part.id}`);
    }

    const { carResponse, brandNames, categories } = await fetchCarData(part);

    if (!carResponse || !brandNames || !categories) {
      logger.warn(
        `Missing car/brand/category data for Part ID ${part.id}, skipping insert.`
      );
      return;
    }
    const metafields = [
      {
        namespace: "custom",
        key: "year",
        type: "single_line_text_field",
        value: carResponse.year_end
          ? `${carResponse.year_start}-${carResponse.year_end}`
          : `${carResponse.year_start}`,
      },
      {
        namespace: "custom",
        key: "car",
        type: "single_line_text_field",
        value: brandNames.name,
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
        value: carResponse.name,
      },
      {
        namespace: "custom",
        key: "product_type",
        type: "single_line_text_field",
        value: categories.lv,
      },
    ];

    const locationResponse = await shopifyGraphQLRequest({
      query: getLocation(),
      variables: {},
    });

    const locationId = locationResponse.data.data.locations.edges[0].node.id;

    const publicationIdResponse = await shopifyGraphQLRequest({
      query: `query { publications(first: 5) { edges { node { id name } } } }`,
      variables: {},
    });

    const productInput = {
      input: {
        title: part.name || "No Title",
        descriptionHtml: part.notes || "No description",
        tags: ["parts"],
        metafields,
        publications: [
          {
            publicationId:
              publicationIdResponse.data.data.publications.edges[0].node.id,
          },
        ],
        variants: [
          {
            price: part.original_price || part.price || "0.00",
            barcode: part.manufacturer_code || "",
            inventoryManagement: "SHOPIFY",
            inventoryPolicy: "DENY",
            ...(part.status === "0" && {
              inventoryQuantities: {
                locationId,
                availableQuantity: 1,
              },
            }),
          },
        ],
      },
      media: part.part_photo_gallery,
    };

    const productResponse = await shopifyGraphQLRequest({
      query: productCreate,
      variables: productInput,
    });

    if (productResponse.data.data.productCreate.userErrors.length) {
      logger.error(`Unable to store part Id : ${part.id} into shopify.`);
      logger.error("Reason: ", error.message);
      throw new Error(`Unable to store part Id : ${part.id}`);
    }

    const product = productResponse.data.data.productCreate.product;

    const metafieldValues = metafields.reduce((acc, field) => {
      acc[field.key] = field.value;
      return acc;
    }, {});

    await db.collection("rrr-parts").insertOne(part);

    await db.collection("shopify-parts").insertOne({
      ...product,
      rrr_partId: part.id,
      metafields: metafieldValues,
    });

    // if (imageProcessing?.filePaths) {
    //   await deleteMedias(imageProcessing.filePaths);
    //   logger.info(`🗑️ Media deleted from S3 for Part ID ${part.id}`);
    // }

    logger.info(`✅ Part ID ${part.id} successfully stored in Shopify.`);
  } catch (error) {
    logger.error(`Error inserting part ID ${part.id}: ${error.message}`);
  }
};

async function updatePartInShopify(part, existingEntry, db) {
  try {
    let imageProcessing = null;
    if (part?.part_photo_gallery?.length || part?.photo) {
      imageProcessing = await processImage(part);
      part = imageProcessing.part;
      logger.info(`📷 Media processed for Part ID ${part.id}`);

      const mediaIds = existingEntry.media.edges.map((edge) => edge.node.id);
      await shopifyGraphQLRequest({
        query: productDeleteMedia,
        variables: {
          mediaIds,
          productId: existingEntry.id,
        },
      });
      logger.info(`Old images deleted for part : ${part.id}.`);
    }

    const { carResponse, brandNames, categories } = await fetchCarData(part);

    if (!carResponse || !brandNames || !categories) {
      logger.warn(
        `Missing car/brand/category data for Part ID ${part.id}, skipping update.`
      );
      return;
    }

    const metafields = [];

    metafields.push({
      namespace: "custom",
      key: "car",
      type: "single_line_text_field",
      value: brandNames.name,
    });

    metafields.push({
      namespace: "custom",
      key: "part_number",
      type: "single_line_text_field",
      value: part.id,
    });

    metafields.push({
      namespace: "custom",
      key: "product_type",
      type: "single_line_text_field",
      value: categories.lv,
    });

    metafields.push({
      namespace: "custom",
      key: "model",
      type: "single_line_text_field",
      value: carResponse.name,
    });

    if (carResponse.year_start) {
      const yearValue = carResponse.year_end
        ? `${carResponse.year_start}-${carResponse.year_end}`
        : `${carResponse.year_start}`;

      metafields.push({
        namespace: "custom",
        key: "year",
        type: "single_line_text_field",
        value: yearValue,
      });
    }

    if (
      part.name !== existingEntry.title ||
      part.price !== existingEntry.price ||
      part.manufacturer_code !== existingEntry.barcode ||
      part.notes !== existingEntry.description ||
      part.original_price !== existingEntry.price ||
      part?.part_photo_gallery?.length ||
      part?.photo
    ) {
      const response = await shopifyGraphQLRequest({
        query: productUpdate,
        variables: {
          input: {
            id: existingEntry.id,
            metafields,
            title: part.name || "No Title",
            descriptionHtml: part.notes || "",
            status: "ACTIVE",
            variants: [
              {
                id: existingEntry.variants.edges[0].node.id,
                price: part.original_price || part.price || "0.00",
                barcode: part.manufacturer_code || "",
              },
            ],
          },
          media: part.part_photo_gallery,
        },
      });

      let metafieldForDB = { ...existingEntry.metafields };

      if (metafields.length) {
        metafields.forEach((field) => {
          metafieldForDB[field.key] = field.value; // override or insert
        });
      }

      await db.collection("shopify-parts").updateOne(
        { rrr_partId: part.id },
        {
          $set: {
            ...existingEntry,
            ...response.data.data.productUpdate.product,
            metafields: metafieldForDB,
            title: part.name,
            description: part.description,
            price: part.original_price || part.price || "0.00",
            barcode: part.manufacturer_code || "",
            description: part.notes || "No Description",
          },
        }
      );

      // if (imageProcessing?.filePaths) {
      //   await deleteMedias(imageProcessing.filePaths);
      //   logger.info(`🗑️ Media deleted from S3 for Part ID ${part.id}`);
      // }

      logger.info(`✅ Part ID ${part.id} successfully updated in Shopify.`);
    }
  } catch (error) {
    throw error;
  }
}

export const scheduleDailyJob = async () => {
  try {
    const db = await connectDB();
    const syncedParts = await db.collection("shopify-parts").find({}).toArray();

    const allAPIIds = new Set();
    const limit = 100;
    let totalPages = 1; // Default to 1, will update after first API call

    for (let page = 1; page <= totalPages; page++) {
      try {
        const response = await axios.post(partsEndpoint, formData, {
          params: { page, limit },
        });

        const apiParts = response.data.data;
        totalPages = Math.ceil(response.data.pagination.total_count / limit);

        for (const part of apiParts) {
          try {
            allAPIIds.add(part.id);

            const existing = syncedParts.find((p) => p.rrr_partId === part.id);

            if (!existing) {
              logger.info(`🆕 New part found: ${part.id}`);
              await insertSinglePartToShopify(part, db);
            } else {
              await updatePartInShopify(part, existing, db);
            }
          } catch (error) {
            logger.error(
              `Error While Running Cron Job for part : ${part.id}`,
              error
            );
            continue;
          }
        }
      } catch (pageError) {
        logger.error(
          `Error processing page ${page} of parts API: ${pageError.message}`
        );
        continue;
      }
    }

    // Handle deleted parts
    const deletedParts = syncedParts.filter(
      (p) => !allAPIIds.has(p.rrr_partId)
    );
    for (const deleted of deletedParts) {
      try {
        await shopifyGraphQLRequest({
          query: productUpdate,
          variables: {
            input: {
              id: deleted.id,
              status: "DRAFT",
            },
          },
        });
        logger.info(`⚠️ Part deleted in API: ${deleted.rrr_partId}`);
      } catch (error) {
        logger.error(
          `Error marking part ${deleted.rrr_partId} as DRAFT: ${error.message}`
        );
      }
    }
  } catch (error) {
    logger.error(`Fatal error in scheduleDailyJob: ${error.message}`);
  }
};
