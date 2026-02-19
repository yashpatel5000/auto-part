import connectDB from "../db.js";
import downloadImage from "./download-image.js";
import { getLocation, getInventoryLevel } from "../graphql/query.js";
import {
  productCreate,
  productUpdate,
  productDeleteMedia,
} from "../graphql/mutation.js";
import { shopifyGraphQLRequest } from "./shopify-axios.js";
import logger from "./logger.js";
import axios from "axios";
import { partsEndpoint } from "./constant.js";
import { config } from "../config.js";
import { GraphQLClient, gql } from "graphql-request";

const formData = new URLSearchParams();
formData.append("username", config.PARTS_API_USER_NAME);
formData.append("password", config.PARTS_API_PASSWORD);
formData.append("user_token", config.PARTS_API_USER_TOKEN);

const shopifyClient = new GraphQLClient(
  `${config.STORE.replace(/\/$/, "")}/admin/api/2024-10/graphql.json`,
  {
    headers: {
      "X-Shopify-Access-Token": config.SHOPIFY_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
  }
);

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

async function fetchRefData() {
  try {
    const [carModelsRes, brandsRes, categoriesRes] = await Promise.all([
      axios.post("https://api.rrr.lt/get/car_models", formData),
      axios.post("https://api.rrr.lt/get/car_brands", formData),
      axios.post("https://api.rrr.lt/get/categories", formData),
    ]);
    return {
      carModels: carModelsRes.data.list,
      brands: brandsRes.data.list,
      categories: categoriesRes.data.list,
    };
  } catch (error) {
    logger.error(`Error fetching reference data: ${error.message}`);
    throw error;
  }
}

async function fetchCarData(part, refData) {
  try {
    const carModelResponse = await axios.post(
      `https://api.rrr.lt/get/car/${part.car_id}`,
      formData
    );
    const car_model_id = carModelResponse.data.list[0][0].car_model;

    const carResponse = refData.carModels.find(
      (model) => model.id === car_model_id.toString()
    );
    const brandNames = refData.brands.find(
      (brand) => brand.id === carResponse?.brand
    );
    const categories = refData.categories.find(
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

const updateVariantMutation = gql`
  mutation productVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        barcode
        inventoryPolicy
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const enableInventoryTrackingMutation = gql`
  mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
        tracked
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const setInventoryQtyMutation = gql`
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        reason
        changes {
          name
          quantityAfterChange
          item {
            id
          }
          location {
            id
            name
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function setInventoryToOne(inventoryItemId, locationId) {
  const inventoryRes = await shopifyClient.request(
    enableInventoryTrackingMutation,
    { id: inventoryItemId, input: { tracked: true } }
  );

  if (inventoryRes.inventoryItemUpdate.userErrors?.length) {
    logger.error(
      `⚠️ Inventory tracking errors: ${JSON.stringify(inventoryRes.inventoryItemUpdate.userErrors)}`
    );
    return;
  }

  const qtyResponse = await shopifyClient.request(setInventoryQtyMutation, {
    input: {
      reason: "correction",
      name: "available",
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId, locationId, quantity: 1 }],
    },
  });

  if (qtyResponse.inventorySetQuantities.userErrors?.length) {
    logger.error(
      `⚠️ Quantity set error: ${JSON.stringify(qtyResponse.inventorySetQuantities.userErrors)}`
    );
  } else {
    logger.info(`✅ Inventory set to 1 for item ${inventoryItemId}`);
  }
}

const insertSinglePartToShopify = async (part, db, locationId, refData) => {
  try {
    let imageProcessing = null;
    if (part?.part_photo_gallery?.length || part?.photo) {
      imageProcessing = await processImage(part);
      part = imageProcessing.part;
      logger.info(`📷 Media processed for Part ID ${part.id}`);
    }

    const { carResponse, brandNames, categories } = await fetchCarData(
      part,
      refData
    );

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

    const actualPrice = part.original_price || part.price;

    const productInput = {
      input: {
        title: part.name || "No Title",
        descriptionHtml: part.notes || "",
        tags: ["parts"],
        metafields,
        status: actualPrice === "0" ? "DRAFT" : "ACTIVE",
      },
      media: part.part_photo_gallery,
    };

    const productResponse = await shopifyClient.request(
      productCreate,
      productInput
    );

    if (productResponse.productCreate.userErrors.length) {
      const errs = JSON.stringify(productResponse.productCreate.userErrors);
      logger.error(`Unable to store part Id ${part.id}: ${errs}`);
      return;
    }

    const product = productResponse.productCreate.product;
    const variant = product.variants.edges[0].node;
    const variantId = variant.id;
    const inventoryItemId = variant.inventoryItem.id;

    const updateVariantRes = await shopifyClient.request(updateVariantMutation, {
      productId: product.id,
      variants: [
        {
          id: variantId,
          price: part.price || "0",
          barcode: part.manufacturer_code || "",
          inventoryPolicy: "DENY",
        },
      ],
    });

    if (updateVariantRes.productVariantsBulkUpdate.userErrors?.length) {
      logger.error(
        `⚠️ Variant update errors for part ${part.id}: ${JSON.stringify(updateVariantRes.productVariantsBulkUpdate.userErrors)}`
      );
    }

    if (part.status === "0") {
      await setInventoryToOne(inventoryItemId, locationId);
    }

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

    logger.info(`✅ Part ID ${part.id} successfully stored in Shopify.`);
  } catch (error) {
    logger.error(`Error inserting part ID ${part.id}: ${error.message}`);
  }
};

async function updatePartInShopify(part, existingEntry, db, locationId, refData) {
  try {
    let imageProcessing = null;

    if (part?.part_photo_gallery?.length || part?.photo) {
      imageProcessing = await processImage(part);
      part = imageProcessing.part;
      logger.info(`📷 Media processed for Part ID ${part.id}`);

      const mediaIds = existingEntry.media.edges.map((edge) => edge.node.id);
      await shopifyGraphQLRequest({
        query: productDeleteMedia,
        variables: { mediaIds, productId: existingEntry.id },
      });
      logger.info(`Old images deleted for part: ${part.id}`);
    }

    const { carResponse, brandNames, categories } = await fetchCarData(
      part,
      refData
    );
    if (!carResponse || !brandNames || !categories) {
      logger.warn(
        `Missing car/brand/category data for Part ID ${part.id}, skipping update.`
      );
      return;
    }

    const metafields = [
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
        key: "product_type",
        type: "single_line_text_field",
        value: categories.lv,
      },
      {
        namespace: "custom",
        key: "model",
        type: "single_line_text_field",
        value: carResponse.name,
      },
    ];

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

    const actualPrice = part.original_price || part.price;
    const newPrice = part.original_price || part.price || "0.00";
    const hasChanged =
      part.name !== existingEntry.title ||
      part.notes !== existingEntry.description ||
      newPrice !== existingEntry.price ||
      part.manufacturer_code !== existingEntry.barcode ||
      part?.part_photo_gallery?.length ||
      part?.photo;

    if (!hasChanged) {
      logger.info(`⏭️ No changes for Part ID ${part.id}, skipping.`);
      return;
    }

    const productUpdateVariables = {
      input: {
        id: existingEntry.id,
        metafields,
        title: part.name || "No Title",
        descriptionHtml: part.notes || "",
        status: actualPrice === "0" ? "DRAFT" : "ACTIVE",
      },
      media: part.part_photo_gallery,
    };

    const productResponse = await shopifyGraphQLRequest({
      query: productUpdate,
      variables: productUpdateVariables,
    });

    const updateVariantRes = await shopifyClient.request(updateVariantMutation, {
      productId: existingEntry.id,
      variants: [
        {
          id: existingEntry.variants.edges[0].node.id,
          price: newPrice,
          barcode: part.manufacturer_code || "",
          inventoryPolicy: "DENY",
        },
      ],
    });

    if (updateVariantRes.productVariantsBulkUpdate.userErrors?.length) {
      logger.error(
        `⚠️ Variant update errors for part ${part.id}: ${JSON.stringify(updateVariantRes.productVariantsBulkUpdate.userErrors)}`
      );
    }

    if (part.status === "0") {
      await setInventoryToOne(
        existingEntry.variants.edges[0].node.inventoryItem.id,
        locationId
      );
    }

    let metafieldForDB = { ...existingEntry.metafields };
    metafields.forEach((field) => {
      metafieldForDB[field.key] = field.value;
    });

    await db.collection("shopify-parts").updateOne(
      { rrr_partId: part.id },
      {
        $set: {
          ...existingEntry,
          ...productResponse.data.data.productUpdate.product,
          metafields: metafieldForDB,
          title: part.name,
          description: part.notes || "",
          price: newPrice,
          barcode: part.manufacturer_code || "",
        },
      }
    );

    logger.info(`✅ Part ID ${part.id} successfully updated in Shopify.`);
  } catch (error) {
    logger.error(`❌ Shopify update failed for part ${part.id}: ${error.message}`);
    throw error;
  }
}

export const scheduleDailyJob = async () => {
  try {
    const db = await connectDB();
    const syncedParts = await db.collection("shopify-parts").find({}).toArray();

    const locationResponse = await shopifyGraphQLRequest({
      query: getLocation(),
      variables: {},
    });
    const locationId = locationResponse.data.data.locations.edges[0].node.id;

    const refData = await fetchRefData();

    const allAPIIds = new Set();
    const limit = 100;
    let totalPages = 1;

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
              await insertSinglePartToShopify(part, db, locationId, refData);
            } else {
              await updatePartInShopify(part, existing, db, locationId, refData);
            }
          } catch (error) {
            logger.error(
              `Error processing part ${part.id}: ${error.message}`
            );
            continue;
          }
        }
      } catch (pageError) {
        logger.error(
          `Error processing page ${page}: ${pageError.message}`
        );
        continue;
      }
    }

    const deletedParts = syncedParts.filter(
      (p) => !allAPIIds.has(p.rrr_partId)
    );
    for (const deleted of deletedParts) {
      try {
        await shopifyGraphQLRequest({
          query: productUpdate,
          variables: { input: { id: deleted.id, status: "DRAFT" } },
        });
        logger.info(`⚠️ Part deleted in API, marked DRAFT: ${deleted.rrr_partId}`);
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
