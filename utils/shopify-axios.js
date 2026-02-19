import axios from "axios";
import { config } from "../config.js";
import logger from "./logger.js";

const shopifyEndpoint = `${config.STORE.replace(/\/$/, "")}/admin/api/2024-10/graphql.json`;

export const shopifyGraphQLRequest = async (body) => {
  try {
    const response = await axios.post(
      shopifyEndpoint,
      JSON.stringify(body),
      {
        headers: {
          "X-Shopify-Access-Token": config.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );
    return response;
  } catch (error) {
    logger.error(`Shopify GraphQL Error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
    throw error;
  }
}
