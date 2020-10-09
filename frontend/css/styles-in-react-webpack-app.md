# styles in React/Webpack app

### styled jsx

Great. A lot like styles in Vue.js. Now supports SCSS. Awesome. Except one thing:

```text
<a href="/about">
    <FA icon={faPhotoVideo} className="x85" /> About
</a>
...
<style jsx>{`
    svg {
        // these styles do not apply!
    }
`}</style>
```

Does not work with FontAwesome components! I'm not sure what's wrong. The `<FA />` component returns an `<svg />` element, which should be styled by styled-jsx. Idk.

