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

### Styled-Components

Until I get the above styled-jsx example to work, I'll stick with Styled-Components.

They are the best compromise - similar styled jsx blocks \(or Vue.js type styles\) in that they are in a file close to the component file. And, they fully support SASS. They syntax is just like writing a stylesheet. No need to waste time and energy writing CSS in JS format.

### Inline Styles \(including tools to make help write them\)

Gross. So much effort transcribing CSS&lt;-&gt;JS formats. Why not write CSS as CSS, in a stylesheet format. Using Styled Components or Style-JSX, you can still keep styles for a module within that module. If you support inline styles, lets talk. I want to know why. 

