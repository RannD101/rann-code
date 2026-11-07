/**
 * Migrasi 11: simpan diff terpadu pada setiap perubahan berkas.
 *
 * Kolom before_text/after_text sudah ada sejak v3, tetapi diff tidak punya
 * tempat. Tanpa kolom ini, audit perubahan hanya menyimpan hash dan kehilangan
 * konteks baris yang berubah.
 */
export const SCHEMA_V11 = `
ALTER TABLE file_changes ADD COLUMN diff_text TEXT;
`;
