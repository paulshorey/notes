# Production

#### Navigating between multiple domains, which load the same scripts/assets...

The browser caches scripts/assets per domain. So, second time a visitor loads the a page in the same domain, they will not have to download all the files again. So, the second and subsequent views load much much faster.

It would be nice to have this fast loading for other domains. So, I'd be able to link from one app to another. From one blog to another. If they are all built using the same scripts/assets, then each new domain should load as fast as if it was just another page.

Solution is to off-load the scripts/images to a CDN, or just to a 3rd party address. This can even be one of the sites. As long as all the sites load assets from the same exact URL. Then, hopping between domains will not require the client to download all new files.

