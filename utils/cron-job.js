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
import { GraphQLClient, gql } from "graphql-request";

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
    const client = new GraphQLClient(`${config.STORE}admin/api/2024-01/graphql.json`, {
      headers: {
        'X-Shopify-Access-Token': config.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    });

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
        descriptionHtml: part.notes || "",
        tags: ["parts"],
        metafields,
      },
      media: part.part_photo_gallery,
    };

    // const productResponse = await shopifyGraphQLRequest({
    //   query: productCreate,
    //   variables: productInput,
    // });
    const productResponse = await client.request(productCreate, productInput);

    if (productResponse.productCreate.userErrors.length) {
      logger.error(`Unable to store part Id : ${part.id} into shopify.`);
      logger.error("Reason: ", error.message);
      throw new Error(`Unable to store part Id : ${part.id}`);
    }

    const product = productResponse.productCreate.product;

    const variant = product.variants.edges[0].node;

    const variantId = variant.id;

    const inventoryItemId = variant.inventoryItem.id;

    console.log("✅ Created product:", product.id);
    console.log("🧩 Default variant:", variantId);
    console.log("📦 Inventory item:", inventoryItemId);

    // 2️⃣ UPDATE VARIANT DETAILS
    const updateVariantMutation = gql`
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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

    const updateVariantRes = await client.request(updateVariantMutation, {
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
      console.error("⚠️ Variant update errors:", updateVariantRes.productVariantsBulkUpdate.userErrors);
    } else {
      console.log("✅ Variant updated successfully:", updateVariantRes.productVariantsBulkUpdate.productVariants[0]);
    }

    if (part.status === "0") {
      const updateInventoryMutation = gql`
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

      const inventoryRes = await client.request(updateInventoryMutation, {
        id: inventoryItemId,
        input: {
          tracked: true, // enable tracking
        },
      });

      if (inventoryRes.inventoryItemUpdate.userErrors?.length) {
        console.error("⚠️ Inventory update errors:", inventoryRes.inventoryItemUpdate.userErrors);
      } else {
        console.log("📦 Inventory tracking enabled:", inventoryRes.inventoryItemUpdate.inventoryItem);
      }

      const setQtyMutation = gql`
      mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            reason
            changes {
              name
              delta
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

      const setQtyVariables = {
        input: {
          reason: "correction", // can be 'correction', 'damage', 'theft', etc.
          name: "available", // optional label
          changes: [
            {
              inventoryItemId: inventoryItemId,
              locationId: locationId,
              delta: 1,
            },
          ],
        },
      };

      const qtyResponse = await client.request(setQtyMutation, setQtyVariables);

      if (qtyResponse.inventoryAdjustQuantities.userErrors?.length) {
        console.error("⚠️ Quantity set error:", qtyResponse.inventoryAdjustQuantities.userErrors);
      } else {
        console.log("✅ Quantity set to 1 successfully!");
      }

    }

    console.log("🎉 Product setup complete!");

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

    const client = new GraphQLClient(`${config.STORE}admin/api/2024-01/graphql.json`, {
      headers: {
        'X-Shopify-Access-Token': config.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    // Step 1: Process images
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
      logger.info(`Old images deleted for part: ${part.id}`);
    }

    // Step 2: Fetch car, brand, category data
    const { carResponse, brandNames, categories } = await fetchCarData(part);
    if (!carResponse || !brandNames || !categories) {
      logger.warn(
        `Missing car/brand/category data for Part ID ${part.id}, skipping update.`
      );
      return;
    }

    // Step 3: Prepare metafields
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

    // Step 4: Update product
    if (
      part.name !== existingEntry.title ||
      part.notes !== existingEntry.description ||
      part?.part_photo_gallery?.length ||
      part?.photo
    ) {

      const actualPrice = part.original_price || part.price;

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

      const locationResponse = await shopifyGraphQLRequest({
        query: getLocation(),
        variables: {},
      });

      const locationId = locationResponse.data.data.locations.edges[0].node.id;

      // 2️⃣ UPDATE VARIANT DETAILS
      const updateVariantMutation = gql`
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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

      const updateVariantRes = await client.request(updateVariantMutation, {
        productId: existingEntry.id,
        variants: [
          {
            id: existingEntry.variants.edges[0].node.id,
            price: part.original_price || part.price || "0.00",
            barcode: part.manufacturer_code || "",
            inventoryPolicy: "DENY",
          },
        ],
      });

      if (updateVariantRes.productVariantsBulkUpdate.userErrors?.length) {
        logger.error("⚠️ Variant update errors:", updateVariantRes.productVariantsBulkUpdate.userErrors);
      } else {
        console.log("✅ Variant updated successfully:", updateVariantRes.productVariantsBulkUpdate.productVariants[0]);
      }

      if (part.status === "0") {
        const updateInventoryMutation = gql`
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

        const inventoryRes = await client.request(updateInventoryMutation, {
          id: existingEntry.variants.edges[0].node.inventoryItem.id,
          input: {
            tracked: true, // enable tracking
          },
        });

        if (inventoryRes.inventoryItemUpdate.userErrors?.length) {
          console.error("⚠️ Inventory update errors:", inventoryRes.inventoryItemUpdate.userErrors);
        } else {
          console.log("📦 Inventory tracking enabled:", inventoryRes.inventoryItemUpdate.inventoryItem);
        }

        //     const setQtyMutation = gql`
        //   mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        //     inventoryAdjustQuantities(input: $input) {
        //       inventoryAdjustmentGroup {
        //         reason
        //         changes {
        //           name
        //           delta
        //           quantityAfterChange
        //           item {
        //             id
        //           }
        //           location {
        //             id
        //             name
        //           }
        //         }
        //       }
        //       userErrors {
        //         field
        //         message
        //       }
        //     }
        //   }
        // `;

        //     const setQtyVariables = {
        //       input: {
        //         reason: "correction", // can be 'correction', 'damage', 'theft', etc.
        //         name: "available", // optional label
        //         changes: [
        //           {
        //             inventoryItemId: existingEntry.variants.edges[0].node.inventoryItem.id,
        //             locationId: locationId,
        //             delta: 1,
        //           },
        //         ],
        //       },
        //     };

        //     const qtyResponse = await client.request(setQtyMutation, setQtyVariables);

        //     if (qtyResponse.inventoryAdjustQuantities.userErrors?.length) {
        //       console.error("⚠️ Quantity set error:", qtyResponse.inventoryAdjustQuantities.userErrors);
        //     } else {
        //       console.log("✅ Quantity set to 1 successfully!");
        //     }

        const setQtyMutation = gql`
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        reason
        changes {
          name
          quantityAfterChange
          item { id }
          location { id name }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

        const setQtyVariables = {
          input: {
            reason: "correction",
            name: "available",
            changes: [
              {
                inventoryItemId: inventoryItemId,
                locationId: locationId,
                quantity: 1, // ✅ always set to 1 (not delta)
              },
            ],
          },
        };

        const qtyResponse = await client.request(setQtyMutation, setQtyVariables);

        if (qtyResponse.inventorySetQuantities.userErrors?.length) {
          console.error("⚠️ Quantity set error:", qtyResponse.inventorySetQuantities.userErrors);
        } else {
          console.log("✅ Quantity set to 1 successfully!");
        }


      }

      // Step 5: Update DB
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
            price: part.original_price || part.price || "0.00",
            barcode: part.manufacturer_code || "",
          },
        }
      );

      // Optionally delete local image files after S3 upload
      // if (imageProcessing?.filePaths) {
      //   await deleteMedias(imageProcessing.filePaths);
      //   logger.info(`🗑️ Media deleted from S3 for Part ID ${part.id}`);
      // }

      logger.info(`✅ Part ID ${part.id} successfully updated in Shopify.`);
    }
  } catch (error) {
    logger.error("❌ Shopify update failed", error);
    throw error;
  }
}


export const scheduleDailyJob = async () => {
  try {
    const db = await connectDB();
    const syncedParts = await db.collection("shopify-parts").find({}).toArray();

    const allAPIIds = new Set();
    const limit = 100;
    let totalPages = 318; // Default to 1, will update after first API call

    for (let page = 318; page <= totalPages; page++) {
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
    // const deletedParts = syncedParts.filter(
    //   (p) => !allAPIIds.has(p.rrr_partId)
    // );
    // for (const deleted of deletedParts) {
    //   try {
    //     await shopifyGraphQLRequest({
    //       query: productUpdate,
    //       variables: {
    //         input: {
    //           id: deleted.id,
    //           status: "DRAFT",
    //         },
    //       },
    //     });
    //     logger.info(`⚠️ Part deleted in API: ${deleted.rrr_partId}`);
    //   } catch (error) {
    //     logger.error(
    //       `Error marking part ${deleted.rrr_partId} as DRAFT: ${error.message}`
    //     );
    //   }
    // }
  } catch (error) {
    logger.error(`Fatal error in scheduleDailyJob: ${error.message}`);
  }
};
