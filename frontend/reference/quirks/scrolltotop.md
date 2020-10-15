# smooth scroll

Smoothly scrolling a window and updating the URL hash seems simple...

Simply using a link `href="#"` does not scroll smoothly. Doing adding onClick `window.scrollTo({ top:0, behavior:"smooth" })` does not update the URL hash.

```text
<a
  href="#"
  onClick={() => {
    /*
     * This function does not execute
     */
    window.scrollTo({ top:0, behavior: "smooth" })
  }}
>scroll to top</a>
```

Solution for static HTML: Must wait until after the scroll animation is finished to change the hash. I'd rather not have to manage the timing though.

```text
<a
  href="#"
  onClick={(e) => {
    e.preventDefault()
    window.scrollTo({ top: 0, behavior: "smooth" })
    setTimeout(function(){window.location.hash = '#'},500)
  }}
>scroll to top</a>
```

Solution for React, using `<Link` instead of `<a>` seems to take care of the timing. However, it does not work with an empty hash. So, scroll `to="#top"` instead of `to="#"`

```text
<Link
  to="#top"
  onClick={() => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }}
>scroll to top</Link>
```

