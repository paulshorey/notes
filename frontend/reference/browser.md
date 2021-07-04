# browser

Inject script to webpage:

```text
(function(d, script) {
    script = d.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.onload = function(){
        // remote script has loaded
    };
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/cheerio/1.0.0-rc.10/lib/cheerio.min.js';
    d.getElementsByTagName('head')[0].appendChild(script);
}(document));
```

