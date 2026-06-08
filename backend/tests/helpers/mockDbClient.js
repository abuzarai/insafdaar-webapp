import { jest } from "@jest/globals";

export function createMockDbClient({
  queryImpl = async () => ({ rows: [], rowCount: 0 }),
} = {}) {
  return {
    query: jest.fn(queryImpl),
    release: jest.fn(),
  };
}
