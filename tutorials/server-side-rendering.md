# Server side rendering

> Best of both worlds = app interactivity + static site speed

For public websites, loading time is crucial. For SEO and good UX, you can not just serve SPA apps without server-side-prerendering them first. However, this introduces a lot of code complexity. Worse, it requires you to re-build all the paths/routes after every change to the content \(using Webhooks\). For an app with many routes and a lot of content, it will take a long time to build and publish. For very small changes, rebuilding everything every time is overkill.

### Option 1: Webhooks

If using a headless CMS like Contentful, or even Wordpress, I'm sure it has a webhook option. Call your server after some content changes. This is a proven and reliable option. It's not as good as Next.js Incremental Builds for regularly changing content, but if your content paths are generated dynamically from some API, then this may be the best option. After done editing, call the webhook \(visit some url like [https://yoursite.co:9999/\_prerender](https://yoursite.co/_prerender)\) to rebuild the entire site.

> But what if you don't want to rebuild the entire site every time?

### Option 2: Next.js Incremental Builds

Next.js solves this using [Incremental builds](https://nextjs.org/docs/basic-features/data-fetching#incremental-static-regeneration). Here is a great quick explanation of server-side rendering by a Next.js developer: [https://www.youtube.com/watch?v=IJkTpR7sSwI](https://www.youtube.com/watch?v=IJkTpR7sSwI) For every route/page you can tell Next.js to periodically re-pre-render the page using latest data. So, every 60 seconds or whatever, each of your pages will re-pre-render.

> But this is not perfect for every use case. Each route/page will fetch the data again and again every minute or so. This only works if it's simple database content which you own. But it gets awkward if you are getting very much data from several APIs: if you're paying for each request, or are rate-limited.

### Option 3: Go back to using PHP

`[<https://mysite.com/some-page?rerender=true>](<https://mysite.com/page1?bustcache=true>)` Pass a URL parameter to the specific page you wish to re-render. If the page has sub-pages then those could be re-rendered also. If you pass it to the entire site `[<https://mysite.com?rerender=true>](<https://mysite.com/page1?bustcache=true>)` then the entire site can be re-rendered.

Back in my PHP days, this is what we did. The Next.js video above is a bit misleading. It starts out explaining the old-fashioned way of rendering data on the server - for every request, the backend language \(PHP, ruby, python\) would go and fetch the data, and render it according to the templating markup. However, it was not mentioned that those old-fashioned websites usually cached their data, instead of getting it new for every request. Every so often, the cache would expire and the new data would be fetched before or after the next time a user landed on that page \(depending how the site is configured\). Or the cache could be cleared manually.

Why not do the same thing with a JAMstack? Well, because the site pages are static files, and separate from the back-end or build process. A JavaScript component in one of the routes in the app can not trigger a build process on itself. See my article "[PHP: back to the future](https://www.notion.so/PHP-Back-to-the-future-77f49fa5bd894be7a7e6d0c2136d3f23)".

> This is the major weakness of JAMstack. Not possible at this time

### Option 4: Separate functionality into micro apps

[Next.js](https://nextjs.org/docs/api-reference/next.config.js/basepath) enables mini-apps. You can run the app in a "basepath". So, instead of the React app taking over all your routes \(/, /about, /product, /etc\), it can be run on just one of the paths!

```text
**Read this:**

**[<https://nextjs.org/docs/api-reference/next.config.js/basepath>](<https://nextjs.org/docs/api-reference/next.config.js/basepath>)

[<https://nextjs.org/blog/incremental-adoption>](<https://nextjs.org/blog/incremental-adoption>)**
```

```text
/
/about
/app     <-- microapp
/support     <-- microapp
/blog     <-- microapp
	/blog?id=first-page-lots-of-crawled-data
	/blog?id=another-page-with-lots-of-data
	/blog?id=keeps-going-for-ever
/products
	/product/some-widget
	/product/super-security
	/product/custom-development
/conta
```

Most first-level routes will be built from your main app. The routes, `/`, `/about`, `/products/...`, and `/contact` will be rendered and built by the main app. They'll be put into the "dist" folder or wherever. When linking between these pages, you can use the `<Link to="/about">about</Link>` provided by your app's router, as any normal built app.

Some of the first-level routes however, will be micro apps, not rendered by the main app. Their "src" code will live outside of this app, wherever you want to store it. `/app`, `/support`, `/blog` Each will start out as it's own app. In development environment, will be previewed on a separate port `localhost:8001`, `localhost:8002`, `localhost:8003`, etc. They shall not use routing. Instead, use query params to navigate between content. Then, you build it, and it will go from "src" to "dist" folder. After, write a bash script which will copy `./dist` to `./main-app/dist/about` or whatever route you want this micro app to be served at.

When linking to and from these micro-apps, you will not be able to use the app's router. Instead, you have to use regular HTML anchor element. The visitor's browser will have to reload the page when entering the micro app, or coming back to the main app. This should be OK however, for 2 reasons. **Micro-apps shall be pre-rendered and very tiny and efficient.** They should use **Preact** or similar small efficient framework. Coming back to the main app, most likely the user started out on the main app, so all the heavy files will already be cached on their browser. So, loading each page should be very quick! However, realistically, this means ALL links to new pages will have to use HTML `<a href="">` tags. So, it still won't be as fast as the router's `<Link to="">`.

> The css/branding can be the same. You'll have to set it up so both the main app and micro apps import the same files. But this whole system does take a lot more development! Still, it's some powerful stuff.

Work in progress... mostly obsolete stuff below...

## Let's see some code...

#### What tech to use?

React app \(Gatsby or whatever\) for the main app. Preact for the mini apps.

#### How to share CSS/assets between main app and mini apps?

Unfortunately, they'll have to be plain css files. Bad idea to use SCSS or whatever component styles and compile them separately for each build - that would lead to lots of duplicate redundant css included individually into each app. Has to be one css file for all apps. You can still use SCSS or StyledComponents, but it has to be kept in a central location and imported by both main app and mini apps. Then, each when each app edits the SCSS, it can compile it to a CSS version right next to it. Images, svg files, JSON files, etc also in that central assets folder.

#### node\_modules

Projects outside of the project folder can actually reference a different node\_modules folder

#### Build process...

Unfortunately, I don't think this setup will work in a standard pre-configured setup like Netlify. This requires a very custom build process.

* **main app**
  * before build, copy all the micro-app folders out of the "build" dir
  * after build, paste the micro-app folders back into the "build" dir
* **each mini app**
  * after build, paste the micro-app "build" dir into the "main-app/build" dir, into a folder named whatever route the micro-app should be served at
  * to rebuild, need to run a separate Node process for each, which listens for a webhook

### Wait, why am I doing this?

It'd be nice to separate a huge app with a ton of content into several smaller apps each with a small enough amount of content to be re-built anytime the content is edited.

But I don't have a huge app. I can build my entire app just fine.

So I'm just doing this for the possibility of suggesting it to an enterprise client or employer? That will never happen. The only time a project can completely change its architecture and technology is when it's starting out.

But I do want to start a large app. Lets plan out my idea for a business/web-development resource. I plan to host a lot of content, in many categories, and use Notion as a CMS. So, for each category, I'd have to crawl a published Notion page, and all its sub-pages.

/ — homepage

/about — static page

/contact

/events — miniapp

/jobs — miniapp

/trends — content from API

/web-dev-recipes — content from web crawler, from Notion site

/web-dev-recipes?category=whatever — show only blog items in a certain category

/web-dev-recipes?id=some-title — show only a specific blog item

/web-dev-tools — content from web crawler, from Notion site

/web-dev-tools?category=whatever

/web-dev-tools?id=some-saas

/biz-dev-tools — content from web crawler, from Notion site

/biz-dev-tools?category=whatever

/biz-dev-tools?id=some-saas

/inspiration — content from web crawler, from Notion site

/inspiration?category=whatever

/inspiration?id=some-saas

Or something like this. Anyway, it will scrape a few Notion sites. Each one I imagine will be a separate API with very much content and meny routes, so each will take a while to re-build. Next.js incremental builds will not be a great solution, because I don't plan to get data from a CMS for each individual page, but instead get a whole lot of data for an entire set of pages.

/ /about /features /pricing /demo - miniapp /api - documentation from web crawler API, from Notion or other source /contact

Smaller site. Contains one set of "blog" type pages crawled from Notion or similar source. This can be rendered all at once. The demo app also could be managed as part of the main app too.

So, I'm putting this idea of combining multiple micro apps on hold until I get content together for the large site, and practice crawling Notion or whatever for a smaller site.

For now, will continue with the **Option 1: Webhooks**!

