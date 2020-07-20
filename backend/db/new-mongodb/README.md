# MongoDB

## NodeJS usage:

{% embed url="http://mongodb.github.io/node-mongodb-native/3.5/tutorials/crud/" %}

^^^ all kinds of great examples, including connecting and adding collections/indexes.

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





