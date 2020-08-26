# CSS

#### Use "rem" units, to make the entire page responsive, effortlessly.

Set `font-size` of the html tag, in pixels. Then, **EVERYWHERE ELSE IN THE PAGE**, use `rem` unit instead of `px`, to set the font-size. Also use rem to set padding, margin, border, height, width, anything! 

In the main css file, set "responsive" breakpoints / media queries, to adjust the font-size of the html tag. For smaller screens, make the font-size smaller. For bigger screens, make it bigger. 

Then, because you used `rem` for all other sizes... whenever the screen gets smaller, all elements will automatically "respond" to fit to the smaller screen, like **magic!** This is not just "responsive", but "adaptive".

## Cool trick: CSS element\(\) function

Turns any div into an image! Useful for a DIY "minimap":  
[https://css-tricks.com/using-the-little-known-css-element-function-to-create-a-minimap-navigator/](https://css-tricks.com/using-the-little-known-css-element-function-to-create-a-minimap-navigator/)



