# Functions

## substr \(cut off first 3 characters\)

`ALTER TABLE data.words ALTER COLUMN pos1 TYPE varchar(3) USING substr("pos1", 1, 3)`

