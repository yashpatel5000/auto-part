import logger from "../../../utils/logger.js";
import connectDB from "../../../db.js";
import { shopifyGraphQLRequest } from "../../../utils/shopify-axios.js";
import { inventoryAdjustQuantity } from "../../../graphql/mutation.js";
import { getInventoryLevel, getLocation } from "../../../graphql/query.js";

export class Service {
  static async webhook(body) {
    try {
      const { event } = body;
      if (event.event_type !== "part.status.changed") return;

      const db = await connectDB();
      const result = await db.collection("shopify-parts").findOne({
        rrr_partId: event.event_data.part_id,
      });

      if (!result) {
        logger.warn(`Webhook: part ${event.event_data.part_id} not found in DB`);
        return;
      }

      const inventoryItemId = result.variants.edges[0].node.inventoryItem.id;

      const locationResponse = await shopifyGraphQLRequest({
        query: getLocation(),
        variables: {},
      });
      const locationId =
        locationResponse.data.data.locations.edges[0].node.id;

      if (event.event_data.status.toLowerCase() === "in_warehouse") {
        await shopifyGraphQLRequest({
          query: inventoryAdjustQuantity,
          variables: {
            input: {
              reason: "correction",
              name: "available",
              changes: [{ inventoryItemId, delta: 1, locationId }],
            },
          },
        });
      } else {
        const inventoryLevel = await shopifyGraphQLRequest({
          query: getInventoryLevel,
          variables: { inventoryItemId },
        });

        const currentQty =
          inventoryLevel.data.data.inventoryItem?.inventoryLevels?.edges?.[0]
            ?.node?.quantities?.[0]?.quantity ?? 0;

        if (currentQty > 0) {
          await shopifyGraphQLRequest({
            query: inventoryAdjustQuantity,
            variables: {
              input: {
                reason: "correction",
                name: "available",
                changes: [{ inventoryItemId, delta: -currentQty, locationId }],
              },
            },
          });
        }
      }

      logger.info(`Webhook processed for part ${event.event_data.part_id}`);
    } catch (error) {
      logger.error(
        `Error processing webhook for part id: ${body?.event?.event_data?.part_id}`
      );
      logger.error(`Reason: ${error.message}`);
    }
  }
}
