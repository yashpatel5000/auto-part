import logger from "../../../utils/logger.js";
import connectDB from "../../../db.js";
import { shopifyGraphQLRequest } from "../../../utils/shopify-axios.js";
import { productUpdate } from "../../../graphql/mutation.js";

export class Service {
 static async webhook (body){
  try {
    const { event } = body;
    if (event.event_type === "part.status.changed") {
      const db = await connectDB(); 
      const result = await db.collection("shopify-parts").findOne({
        rrr_partId: event.event_data.part_id,
      });

      if (result) {
        const variables = {
          input: {
            id: result.id,
            status:
              event.event_data.status.toLowerCase() === "sold"
                ? "DRAFT"
                : "ACTIVE",
          },
        };

        await shopifyGraphQLRequest({
          query: productUpdate,
          variables,
        });
        logger.info("Received webhook", { body });
      }
    }
  } catch (error) {
    logger.error(
      "Error processing webhook for part id : ",
      req.body.event.event_data.part_id,
      { error: err.message }
    );
  }
}}