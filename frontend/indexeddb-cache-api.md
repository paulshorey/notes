# IndexedDB

{% embed url="https://javascript.info/indexeddb" %}

```text
  const openIDB = await openDB('new-jobs');
  openIDB.onupgradeneeded = function() {
    let db = openRequest.result;
    // cleanup old objects
    // db.deleteObjectStore('books')
    // create new objects
    if (!db.objectStoreNames.contains('books')) {
      db.createObjectStore('books', {keyPath: 'id'});
    }
  };
```

{% embed url="https://blog.logrocket.com/javascript-cache-api/" caption="^^^ Also see Cache API \(alternative to IndexedDB\)" %}





