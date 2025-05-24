import axios from "axios";
import { config } from "../config.js";

export const shopifyGraphQLRequest = async (body) => {
  try {
    const response = await axios.post(
      "https://auto-part-sale.myshopify.com/admin/api/2025-01/graphql.json",
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
    console.error("Shopify GraphQL Error:", error.response?.data || error.message);
    throw error;
  }
}
