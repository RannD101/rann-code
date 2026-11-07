export const SCHEMA_V5 = `
ALTER TABLE models ADD COLUMN cache_read_price REAL;
ALTER TABLE models ADD COLUMN cache_write_price REAL;
`;
