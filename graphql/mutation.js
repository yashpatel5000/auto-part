export const productCreate = `
    mutation productCreate($input: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $input, media: $media) {
            product {
                id
                title
                description
                variants(first: 1) {
                  edges {
                    node {
                      id
                    }
                  }
                }
                media(first: 250){
                    edges{
                        node{
                            id
                        }
                    }
                }
              }
            userErrors {
                field
                message
            }
        }
    }`;

export const createVariantQuery = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants {
                id
                price
                barcode
                inventoryItem{
                    id
                }
            }
            userErrors {
                field
                message
            }
        }
    }`;

export const updateVariantQuery = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
                id
                price
                barcode
                inventoryItem{
                    id
                }
            }
            userErrors {
                field
                message
            }
        }
    }`;

export const productUpdate = `
    mutation productUpdate($input: ProductUpdateInput!) {
        productUpdate(product: $input) {
            product {
                id
              }
            userErrors {
                field
                message
            }
        }
    }`;

export const inventoryAdjustQuantity = `
mutation inventoryAdjustQuantities($input:  InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup{
        id
    }
    userErrors {
      field
      message
    }
  }
}
`;

export const productDeleteMedia = `
mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
  productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
    deletedMediaIds
    userErrors {
      field
      message
    }
  }
}`;
