# API reference

OpenAPI \(v3\) in Yaml files is the way to document your APIs, but it's complicated to write, so it helps to use an editor, at first. Then you need to publish your docs as a website...

## [Slate](https://slatedocs.github.io/slate/?javascript#introduction)

TODO: try slate. It looks great for API or codebase documentation.

## [SwaggerHub](https://swagger.io/tools/swaggerhub/)

is the way to go for most people and teams. It is reasonably priced - $50/mo for a custom domain, and free if you host on their domain. 

There is also [Swagger-UI](https://swagger.io/tools/swagger-ui/), which is open-source, DIY, and in my opinion pretty bad for enterprise services, as it lacks a way to group endpoints or document anything other than individual endpoints. But, it visualizes your OpenAPI Yaml files, so it's much much better than nothing!

## [Dapperbox](http://dapperdox.io/)

is the better looking and more organized version of Swagger-UI. Use this if you want to host your own site, and don't need fancy features.

## [Stoplight.io](https://stoplight.io) 

**makes it really easy to write the spec!** Not as easy to publish it though. :\( But it's so easy to edit, that I use it to edit, then export the yaml file. Soon, I'll get good enough to just edit the yaml file, and will not need this crutch. Highly recommended for anyone just learning the OpenAPI spec.

* Use the intuitive interface to create your specs. Include every necessary detail.
* Edit the `.yaml` file, if you prefer. It's great practice learning the spec to go back and forth between GUI and IDE.
* Export the yaml file, to import it somewhere else - like RapidAPI or Postman.

How to publish this? Stoplight.io is able to create a full website documentation. You can even export it in markdown format. However, their UI and navigation is pretty bad for site docs.

## [GitBook](https://gitbook.com) 

can also document an API very well. However, it is not currently possible to import/export as OpenAPI yaml files. That's a bummer, because OpenAPI is a requirement in tech. So, GitBook can not replace Stoplight/Swagger. I still use it to publish my API reference, though I have to do it as an additional step \(double the work\). However, I write it on GitBook first, because the interface is so easy to use. This way, I can quickly draft it and change it until it is correct. Then I go to Stoplight \(or Swagger\) to edit the real spec.

It's worth it, because the API reference comes out [looking so good](https://nlp.studio/documentation)!

## Not Quite:

\*\*\*\*[**Redoc.ly**](https://redoc.ly/)  
****It's not ready, still under active development, and is overpriced for what you get.  
Here's a blog that sings its praises. Fun thing is this entire website \(if you just go to the domain without the path\) only hosts this one article. The domain "mytech.reviews" must have been bought by Redoc.ly, just for this purpose. Lol. [https://mytech.reviews/best-free-api-documentation-tools/](https://mytech.reviews/best-free-api-documentation-tools/) How did they get to Google's first page of results??? I need to figure out this voodoo magic!

