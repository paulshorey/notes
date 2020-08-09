---
description: '*** on Ubuntu 18, Postgres v 12 ***'
---

# backup / restore

## First, on local: **Copy backup file to server:**

`scp /www/words-data-07-09-after-poss.sql root@142.93.251.57:/tmp/db-backup-july.sql`

## **Restore schema only \(no data\):**

`pg_restore --host "localhost" --port "5432" --username "postgres" --dbname "words" --verbose "/tmp/db-backup-july.sql"`

## **Restore data:**

### **Restore specific schema:**

**FIRST,**  
`sudo -i -u postgres`, `psql words`, `DROP SCHEMA data CASCADE;`**, don't leave out the semicolon!**  
Wait for confirmation response "DROP SCHEMA".

**THEN,**  
`CREATE SCHEMA data AUTHORIZATION nodejs;`**, again, don't leave out the semicolon!**  
Wait for confirmation response "DROP SCHEMA".

**THEN,**  
`\q`, don't forget this bit!  
`pg_restore --host "localhost" --port "5432" --username "postgres" --dbname "words" --verbose --schema "data" "/tmp/data.sql"`

Enter password when prompted, and done!

## **MacOS PgAdmin4 v 11...**

**Backup specific schema:**`pg_dump --file "/www/words.crawl.sql" --host "localhost" --port "7777" --username "postgres" --no-password --verbose --format=c --blobs --schema "crawl" "words"`

\*\*\*\*

## **MacOS PgAdmin4 v 12...**

**Backup specific schema:**  
`pg_dump --file "/www/words.data.sql" --host "localhost" --port "5432" --username "postgres" --no-password --verbose --format=c --blobs --schema "data" "words"`

**Restore specific schema:**  
\(Must drop-cascade tables first\)  
`pg_restore --host "localhost" --port "5432" --username "postgres" --no-password --dbname "words" --verbose --schema "data" "/www/words.data.sql"`

