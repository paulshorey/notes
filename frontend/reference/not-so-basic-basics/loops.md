# loops

Looping over DOM elements \(such as returned by document.querySelectorAll\):

```text
Array.from(elements).forEach((el, index)=>{ console.log(el.innerHTML); })

// don't use for of/in, because it will execute Array.from(elements) each time
```

To remove items from the array, while you're looping over the array, without breaking the current index:

```text
let i = 0;
while (i < list.length) { // new length read and compared to i each time

   if (...something...) {

      list.splice(i, 1); // if delete an item then don't increment index

   } else {

      i++; // if length did not change, then increment indes like normal

   }
}
```

 

