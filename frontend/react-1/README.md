# React

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

#### onClick not working, in drop-down or popup menu

Because React is "reactive", the DOM updates instantly when some data changed. So, if you change some data in the container component, onBlur, that may affect the child component \(the dropdown or popup or tooltip\). The child component may be gone before the onClick event clicked. To the human eye, it looks like it should have worked. But instead, the drop-down or popup disappeared a millisecond before the click.

