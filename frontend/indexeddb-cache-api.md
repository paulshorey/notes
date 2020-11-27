# IndexedDB

{% embed url="https://javascript.info/indexeddb" caption="^ read this," %}

{% embed url="https://github.com/jakearchibald/idb" %}

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

```text
let transaction = db.transaction("books", "readwrite");

// get an object store to operate on it
let books = transaction.objectStore("books");

let book = {
  id: 'js',
  price: 10,
  created: new Date()
};

let request = books.put(book); // overwrite
let request = books.add(book); // fail if exists

request.onsuccess = function() {
  console.log("Book added to the store", request.result);
};

request.onerror = function() {
  console.log("Error", request.error);
};
```

{% embed url="https://blog.logrocket.com/javascript-cache-api/" caption="^^^ Also see Cache API \(alternative to IndexedDB\)" %}





