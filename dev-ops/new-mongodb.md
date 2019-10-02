
#### Run mongo on CLI:

```
mongo;    
use whateverDatabaseYouWant;    
db.createUser({user:"paul",pwd:"",roles:["readWrite"]});    
db.createCollection("whateverCollection");    
db.whateverCollection.insert({"title":"whatever2"});    
db.whateverCollection.find();
```

```
use whatever;    
db.whatever.drop();
```

