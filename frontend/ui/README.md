# UI

**TODO: Use Chakra / Chakra PRO**  
[https://**pro**.chakra-ui.com/components/application-ui](https://pro.chakra-ui.com/components/application-ui)  
[https://chakra-ui.com/docs/overlay/modal](https://chakra-ui.com/docs/overlay/modal#modal-overflow-behavior)

**Try** [**Tailwind CSS**](https://tailwindcss.com/)**.** It looks good!  
Also, [React Components for Tailwind CSS](https://github.com/tailwindlabs/headlessui/tree/develop/packages/%40headlessui-react), decoupled. Use just their CSS, or just their JS. Write your own CSS/JS when needed. Very future-proof!

**CSS Grid**  
[https://grid.layoutit.com/](https://grid.layoutit.com/)

Implement nav menu selected/hover underlines,  
**preferably awesome animated ones like this:**[ ****https://kafene.com/about](https://kafene.com/about)

**Autocomplete using decorators and modern JS:**  
[https://discourse.aurelia.io/t/help-with-handling-keypress-events/2946](https://discourse.aurelia.io/t/help-with-handling-keypress-events/2946)

**CSS resposive background:**

```text
element.style {
    --bg-img-overlay: linear-gradient(rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.35));
    --bg-position: 50% 50%;
    --bg-img-src: url(https://www.mudfire.com/uploads/b/55ead27…/ph200120A_Joao_SQBE_Mudfire_BrandWide_0188_1605020525.jpg);
    --bg-img-src-1200w: url(https://www.mudfire.com/uploads/b/55ead27…/ph200120A_Joao_SQBE_Mudfire_BrandWide_0188_1605020525.jpg?width=1200);
    --bg-img-src-1600w: url(https://www.mudfire.com/uploads/b/55ead27…/ph200120A_Joao_SQBE_Mudfire_BrandWide_0188_1605020525.jpg?width=1600);
    --bg-img-src-2000w: url(https://www.mudfire.com/uploads/b/55ead27…/ph200120A_Joao_SQBE_Mudfire_BrandWide_0188_1605020525.jpg?width=2000);
    --bg-img-src-2400w: url(https://www.mudfire.com/uploads/b/55ead27…/ph200120A_Joao_SQBE_Mudfire_BrandWide_0188_1605020525.jpg?width=2400);
    color: var(--light-text-color);
}
@media (max-width: 1200px)
.w-image-block--responsive[data-v-638c7dba] {
    background-image: var(--bg-img-overlay),var(--bg-img-src-1200w);
}
@media (max-width: 1600px)
.w-image-block--responsive[data-v-638c7dba] {
    background-image: var(--bg-img-overlay),var(--bg-img-src-1600w);
}
@media (max-width: 2000px)
.w-image-block--responsive[data-v-638c7dba] {
    background-image: var(--bg-img-overlay),var(--bg-img-src-2000w);
}
@media (max-width: 2400px)
.w-image-block--responsive[data-v-638c7dba] {
    background-image: var(--bg-img-overlay),var(--bg-img-src-2400w);
}
```



