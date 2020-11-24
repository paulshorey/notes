# ElasticSearch

[https://dev.to/hsatac/management-gui-for-elasticsearch-17g9](https://dev.to/hsatac/management-gui-for-elasticsearch-17g9)   
\(about various clients\)  
[https://www.elastic.co/start](https://www.elastic.co/start) \(get Kibana\)

SQL is very limited. See: [https://www.elastic.co/guide/en/elasticsearch/reference/current/sql-syntax-select.html](https://www.elastic.co/guide/en/elasticsearch/reference/current/sql-syntax-select.html)

```text
SELECT title FROM "en-wikipedia" WHERE MATCH(title, 'interesting') LIMIT 100;

SELECT revision.text._ as text FROM "en-wikipedia" WHERE title = 'May you live in interesting times' LIMIT 1;

SELECT title, revision.text._ as text FROM "en-wikipedia" WHERE MATCH(text, 'interesting') LIMIT 10;

SELECT score, title FROM (SELECT SCORE() as score, title, revision.text._ as text FROM "en-wikipedia" WHERE MATCH(text, 'interesting') ORDER BY score DESC LIMIT 100);
```

EQL for use with Javascript or other Object-based queries:  
[https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html)

[https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/suggest\_examples.html](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/suggest_examples.html)

