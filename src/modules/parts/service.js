import dotenv from "dotenv";
import axios from "axios";

import connectDB from "../../../db.js";
import { partsEndpoint } from "../../../utils/constant.js";
import { deleteMedias } from "../../../utils/aws.js";
import downloadImage from "../../../utils/download-image.js";
import { shopifyGraphQLRequest } from "../../../utils/shopify-axios.js";
import {
  productCreate,
  createVariantQuery,
} from "../../../graphql/mutation.js";

dotenv.config();

const partsApiAuth = {
  username: process.env.PARTS_API_USER_NAME,
  password: process.env.PARTS_API_PASSWORD,
  user_token: process.env.PARTS_API_USER_TOKEN,
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
    const totalPages = Math.ceil(25900 / limit);

    for (let page = 1; page <= totalPages; page++) {
      console.log(`📥 Fetching products for page ${page}`);

      const formData = new URLSearchParams();
      formData.append("username", partsApiAuth.username);
      formData.append("password", partsApiAuth.password);
      formData.append("user_token", partsApiAuth.user_token);

      const response = await axios.post(partsEndpoint, formData, {
        params: { page, limit },
      });

      const allParts = response.data.data;

      for await (let part of allParts) {
        const exists = await db.collection("rrr-parts").findOne({ id: part.id });

        if (exists) {
          console.log(`ℹ️ Part ID ${part.id} already exists in Shopify.`);
          continue;
        }

        let imageProcessing = null;

        if (part?.part_photo_gallery?.length || part?.photo) {
          imageProcessing = await processImage(part);
          part = imageProcessing.part;
          console.log(`📷 Media processed for Part ID ${part.id}`);
        }

        const productInput = {
          input: {
            title: part.name || "No Title",
            descriptionHtml: part.notes || "No description",
            tags: ["parts"],
          },
          media: part.part_photo_gallery,
        };

        try {
          const productResponse = await shopifyGraphQLRequest({
            query: productCreate,
            variables: productInput,
          });

          const product = productResponse.data.data.productCreate.product;
          const productId = product.id;
          const variantId = product.variants.edges[0].node.id;

          const variantInput = {
            productId,
            variants: [
              {
                id: variantId,
                price: part.original_price || "0.00",
                barcode: part.manufacturer_code || "",
              },
            ],
          };

          const variantResponse = await shopifyGraphQLRequest({
            query: createVariantQuery,
            variables: variantInput,
          });

          await db.collection("rrr-parts").insertOne(part);

          await db.collection("shopify-parts").insertOne({
            ...product,
            ...variantResponse.data.data.productVariantsBulkUpdate.productVariants[0],
            rrr_partId: part.id,
            media: part.part_photo_gallery,
            shopifyProductId: productId,
          });

          if (imageProcessing?.filePaths) {
            await deleteMedias(imageProcessing.filePaths);
            console.log(`🗑️ Media deleted from S3 for Part ID ${part.id}`);
          }

          console.log(`✅ Part ID ${part.id} successfully stored in Shopify.`);
        } catch (error) {
          console.error(`❌ Error creating product/variant: ${error.message}`);
        }
      }
    }
  } catch (err) {
    console.error(`❌ API Error: ${err.message}`);
    throw err;
  }
}
