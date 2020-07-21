# advanced SQL

## DISTINCT

Sub-query gets all the results you want, ordered how you want. Main query makes one field unique.

`SELECT DISTINCT ON (email) FROM (SELECT FROM users.contacts ORDER BY text_len DESC) one`

When doing this on my contacts table, it gives me every recorded email \(which is not a unique field\), but does not give me duplicates. Instead, it gives me the best row in this email, the row with the most information about the user \(name, phone, description, etc.\).

One more complication. I want to order these unique \(distinct\) emails \(rows\) by date. Will have to wrap another time. I don't think it queries the database again and again, just works with the rows in memory. So, this makes sense to me. Actually miss working on a team now. Would love to run such things by a senior back-end dev.

`SELECT  FROM (SELECT DISTINCT ON (email)  FROM (SELECT * FROM users.contacts ORDER BY text_len DESC) one LIMIT 1000) two ORDER BY date DESC`

## where **"=" multiple values**

`SELECT ... FROM ... WHERE something IN ('one','two',3,4)`

`SELECT key,list_count,ws_sentiment FROM data.words WHERE key IN ('submissions','indications','motions','hint','allusions','clues');`

## replace

`Use SELECT to display replaced value. Remove when using in SQL query.`

`SELECT REPLACE(REPLACE(REPLACE((SELECT list FROM data.words WHERE key='wordy'), '[',''),']',''),'"','''')`

## function: substr \(cut off first 3 characters\)

`ALTER TABLE data.words ALTER COLUMN pos1 TYPE varchar(3) USING substr("pos1", 1, 3)`

