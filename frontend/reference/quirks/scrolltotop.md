# scrollToTop\(\)

Smoothly scrolling a window back to top and updating the URL hash - proves difficult. Maybe I'm doing it wrong?

Trying to scroll to top of page... `href="/#"` refreshes the page `href="#"` scrolls up instantly. Doing only `window.scrollTo({ top:0, behavior:"smooth" })` does not update the URL hash.

```text
<a
  href="#"
  onClick={() => {
    /*
     * This is not smooth, because the href="#" prevents onClick from firing
     * So, it scrolls, but does not update hash="#"
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
<a name="top" />
...
<Link
  to="#top"
  className="link"
  onClick="window.scrollTo({ top: 0, behavior: "smooth" })"
>scroll to top</Link>
```
