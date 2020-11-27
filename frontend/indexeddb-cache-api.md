# IndexedDB

{% embed url="https://javascript.info/indexeddb" %}

```text
  const openIDB = await openDB('new-jobs');
  openIDB.onupgradeneeded = function() {
    let db = openRequest.result;
    if (!db.objectStoreNames.contains('books')) { // if there's no "books" store
      db.createObjectStore('books', {keyPath: 'id'}); // create it
    }
  };
```

{% embed url="https://blog.logrocket.com/javascript-cache-api/" caption="^^^ Also see Cache API \(alternative to IndexedDB\)" %}





