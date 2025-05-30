import logger from "../../../utils/logger.js";
import connectDB from "../../../db.js";
import { shopifyGraphQLRequest } from "../../../utils/shopify-axios.js";
import {
  inventoryAdjustQuantity,
} from "../../../graphql/mutation.js";
import { getInventoryLevel, getLocation } from "../../../graphql/query.js";

export class Service {
  static async webhook(body) {
    try {
      const { event } = body;
      if (event.event_type === "part.status.changed") {
        const db = await connectDB();
        const result = await db.collection("shopify-parts").findOne({
          rrr_partId: event.event_data.part_id,
        });

        if (result) {
          const inventoryItemId = result.variants.edges[0].node.inventoryItem.id;
          if (event.event_data.status.toLowerCase() === "in_warehouse") {

            const locationResponse = await shopifyGraphQLRequest({
              query: getLocation(),
              variables: {},
            });
                    
            const locationId = locationResponse.data.data.locations.edges[0].node.id;

            await shopifyGraphQLRequest({
              query: inventoryAdjustQuantity,
              variables: {
                input: {
                  reason: "correction",
                  name: "available",
                  changes: {
                    inventoryItemId,
                    delta: +1,
                    locationId
                  },
                },
              },
            });
          
          } else {
          
            const inventoryLevel = await shopifyGraphQLRequest({
              query: getInventoryLevel(inventoryItemId),
              variables: {},
            });

            const locationResponse = await shopifyGraphQLRequest({
              query: getLocation(),
              variables: {},
            });
                    
            const locationId = locationResponse.data.data.locations.edges[0].node.id;

            await shopifyGraphQLRequest({
              query: inventoryAdjustQuantity,
              variables: {
                input: {
                  reason: "correction",
                  name: "available",
                  changes: {
                    inventoryItemId,
                    delta:
                      -inventoryLevel.data.data.inventoryItem.inventoryLevels
                        .edges[0].node.quantities[0].quantity,
                    locationId
                  },
                },
              },
            });
          }

          logger.info("Received webhook", { body });
        }
      }
    } catch (error) {
      logger.error(
        `Error processing webhook for part id : ${body.event.event_data.part_id}`
      );
      logger.error(`Reason : ${error.message}`)
    }
  }
}
