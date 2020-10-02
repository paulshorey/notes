# Indexes

## ILIKE %keyword% - very useful, reverse search!

**To add GIN/GIST index, install it on the entire database, then create it on the specific table/column:**

`CREATE EXTENSION pg_trgm WITH SCHEMA pg_catalog;` 

`CREATE INDEX trgm_syns ON data.domains USING GIST (syns gist_trgm_ops);` 

Replace "syns" with column name. There is also "GIN" index type, instead of "GIST". Same thing...

"For dynamic data, **GiST indexes** are faster to update. Specifically, **GiST indexes** are very good for dynamic data and fast if the number of unique words \(lexemes\) is under 100,000, while **GIN indexes** will handle 100,000+ lexemes better but are slower to update."

**To drop GIN/GIST index, do it on the entire schema:**

`DROP INDEX data.trgm_syns2;` 





