export const getLocation = () => {
  return `
    query {
      locations(first: 5) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
};

export const getOptionId = () => {
  return `
    query GetProductOptions($id: ID!) {
  product(id: $id) {
    options {
      id
      name
      values
    }
  }
}
`;
};

export const getInventoryLevel = (inventoryItemId) => {
  return `
    query {
      inventoryItem(id: "${inventoryItemId}") {
        id
        inventoryLevels(first: 10) {
          edges {
            node {
              id
              quantities(names: "available"){
                name
                quantity
              }
            }
          }
        }
      }
    }
  `;
};
