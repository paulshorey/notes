# Indexes

## ILIKE %keyword% - very useful, reverse search!

`CREATE EXTENSION pg_trgm WITH SCHEMA pg_catalog;` 

`CREATE INDEX trgm_syns ON data.domains USING GIST (syns gist_trgm_ops);` 

Replace "syns" with column name. There is also "GIN" index type, instead of "GIST". Same thing...

"For dynamic data, **GiST indexes** are faster to update. Specifically, **GiST indexes** are very good for dynamic data and fast if the number of unique words \(lexemes\) is under 100,000, while **GIN indexes** will handle 100,000+ lexemes better but are slower to update."

**Run SQL query in CLI postgres:**

```text
psql -U username mydatabase 
mydatabase=#
```

At this point you can enter a query directly but **you must remember to terminate the query with a semicolon `;`**

