# advanced SQL

## Delete the top N rows, WHERE, ORDER BY, LIMIT, etc...

`DELETE FROM data.words WHERE ctid IN ( SELECT ctid FROM data.words WHERE vrsn IS NULL AND list='[]' ORDER BY timestamp DESC LIMIT 761 )` 

## better than DISTINCT

Sub-query gets all the results you want, ordered how you want. Main query makes one field unique.

`SELECT * DISTINCT ON (email) FROM (SELECT * FROM users.contacts ORDER BY text_len DESC) one`

When doing this on my contacts table, it gives me every recorded email \(which is not a unique field\), but does not give me duplicates. Instead, it gives me the best row in this email, the row with the most information about the user \(name, phone, description, etc.\).

**But... I want to order these** unique \(distinct\) emails \(rows\) by date \(a different field\). Tried wrapping in another SELECT parenthesis, but didn't work. I miss working on a team now. Would love to run such things by a more experienced back-end dev. **This did not work...**

`SELECT * FROM (SELECT DISTINCT ON (email) * FROM (SELECT * FROM users.contacts ORDER BY text_len DESC) one LIMIT 1000) two ORDER BY date DESC`

**But this did...** wrap a query in "WITH \_ AS", then filter that by an added "row number" field, and order the remaining rows by date. Now, the final rows will be ordered primarily by text length, only one kept, the one with the longest text length, then ordered again by length.

`WITH myrows AS ( SELECT *, ROW_NUMBER() OVER(PARTITION BY email ORDER BY text_len DESC) AS rn FROM users.contacts ) SELECT s.* FROM myrows s WHERE s.rn = 1 ORDER BY date DESC` 

## where **"=" multiple values**

`SELECT ... FROM ... WHERE something IN ('one','two',3,4)`

`SELECT key,list_count,ws_sentiment FROM data.words WHERE key IN ('submissions','indications','motions','hint','allusions','clues');`

## replace

`Use SELECT to display replaced value. Remove when using in SQL query.`

`SELECT REPLACE(REPLACE(REPLACE((SELECT list FROM data.words WHERE key='wordy'), '[',''),']',''),'"','''')`

## function: substr \(cut off first 3 characters\)

`ALTER TABLE data.words ALTER COLUMN pos1 TYPE varchar(3) USING substr("pos1", 1, 3)`

