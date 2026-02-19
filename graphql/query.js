export const getLocation = () => `
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

export const getInventoryLevel = `
  query GetInventoryLevel($inventoryItemId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      id
      inventoryLevels(first: 10) {
        edges {
          node {
            id
            quantities(names: "available") {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;
