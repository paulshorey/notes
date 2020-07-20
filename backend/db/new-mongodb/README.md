# MongoDB

## NodeJS usage:

**Great documentation and code examples:**  
[http://mongodb.github.io/node-mongodb-native/3.5/tutorials/crud/](http://mongodb.github.io/node-mongodb-native/3.5/tutorials/crud/)

**Find and sort:**  
`db.collection.find().sort( { age: -1 } )` // negative one = descending   
`db.collection.find( { $query: {}, $orderby: { age : -1 } } )`  // uses less memory



## CLI usage:

```text
mongo;    
use whateverDatabaseYouWant;    
db.createUser({user:"paul",pwd:"",roles:["readWrite"]});    
db.createCollection("whateverCollection");    
db.whateverCollection.insert({"title":"whatever2"});    
db.whateverCollection.find();

use whatever;    
db.whatever.drop();
```

---





