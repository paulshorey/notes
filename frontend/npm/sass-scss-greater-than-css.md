# SASS / SCSS -&gt; CSS

{% embed url="https://sunlightmedia.org/sass/" %}

Also includes nice lesson about SCSS/SASS. Skip toward the bottom. Package.json scripts:  
`"scss": "node-sass -w assets/scss -o assets/css"` 

"-o" flag means "--output".   
"-w" flag means "--watch" for changes, remove for production build.

#### What I do:

In development, `import ./some/file.scss`   
In production, do NOT import it, but instead use the compiled css:

```text
<link rel="stylesheet" type="text/css" href="/css/compiled.css"/>
```



