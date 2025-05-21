export const productCreate = `
    mutation productCreate($input: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $input, media: $media) {
            product {
                id
                title
                variants(first: 1) {
                  edges {
                    node {
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
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
                id
                price
                barcode
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
