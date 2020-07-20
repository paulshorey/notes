# MongoDB

## NodeJS usage:

{% embed url="http://mongodb.github.io/node-mongodb-native/3.5/tutorials/crud/" %}

^^^ all kinds of great examples, including connecting and adding collections/indexes.

**Find and sort:**  
`db.collection.find().sort( { age: -1 } )` // negative one = descending   
`db.collection.find( { $query: {}, $orderby: { age : -1 } } )`  // more memory efficient



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





