Let's Get Real (Time): Exploring WPGraphQL Subscriptions 

GraphQL is best known for Queries (fetching data from a server) and Mutations (changing data on a server). But there’s actually a third root operation type that is part of the GraphQL specification: Subscriptions.

Subscriptions are designed to allow clients to receive real-time updates from the server. Unlike Queries and Mutations, which are typically one-off request/response cycles, Subscriptions establish a long-lived connection between the client and the server. When a specific event happens, such as a post being updated, the server can immediately push relevant data to every connected client that has subscribed to that event.

I have been exploring an MVP implementation of WPGraphQL Subscriptions. The idea is to provide developers with a familiar, schema-driven way to “subscribe” to events in WordPress and get real-time updates using the same schema they already use for queries and mutations.

The goal is to provide this functionality via WordPress itself, while providing options to replace pieces of it to support higher scale.

Repo: github.com/wp-graphql/wp-graphql-subscriptions

Why WPGraphQL Subscriptions?

Right now, there’s no standard way to get real-time data from WordPress. WordPress has a great event-driven architecture, but it all lives within a single request-response lifecycle. Only the thread executing the request knows about the events (actions/filters) being triggered, but other users need to refresh their page to see the changes. 

For example if User A corrects a typo on a post, User B doesn't know about it until they refresh the page.

Developers use various workarounds, such as long polling, where the client (browser, typically) repeatedly asks the server “has anything changed yet?”, often getting stale data in response.

Subscriptions flip this model. Instead of the client constantly asking, the server notifies the client when something relevant has changed. And in the case of WPGraphQL Subscriptions, it does so in a way that leverages existing WPGraphQL concepts like the GraphQL Schema, Type system, and Model layer.

Now, User B could see the typo change on a post immediately after User A made it. Extrapolate this out to more than typo corrections, and this means developers could start building real-time applications on top of WordPress. The types of things that are often thought to require tools like Firebase or Supabase. And for those already using WPGraphQL (and features like GraphQL Fragments) they could (in some cases) even add real-time features with only a few lines of code. 

Instead of WordPress being seen as just a content management system for static blog and marketing content, this could unlock WordPress to be a platform for dynamic, collaborative applications. I know this isn't a revolutionary concept. WordPress has been and is often used to power more "application" type of projects than just static content, but this could take that idea to a new level.

Some example use cases:

WooCommerce dashboard with real-time updates for new orders, stock changes, or shipping updates

Real-time chat or comment threads

Kanban-style task boards with multiple users contributing and viewing the changes

Live analytics dashboards for editorial teams

Soccer team management apps

Ok, that last one was pretty specific, but it's an idea I've had floating in my mind for a while, and one that I want to pursue for my own sake, and to prove some of these concepts. 

As a Soccer coach (pardon my en_US), I've been wanting to build a tool that helps me manage things like lineups and playing time, and tracking game events such as goals, assists, and more. I want this to be an application where I can enter data during a game and parents at the field or at home could see updates live. But not only see the updates, I want a team manager or assistant coach to also be able to edit data and collaborate on things like lineups. If multiple people are collaborating at the same time, there's a chance they could override each other's work, which is why it's important to have the real-time updates to ensure the collaborative nature. 

While a Soccer team management app like this could be built using Supabase or similar, all of the "data" needed for this type of application is just different types of content, and WordPress is already the best content management system I know! If we can bring some of the real-time data functionality to WordPress, it could fit the bill for applications like this quite well. 

Proof of Concept 

I've not yet built a full on Soccer team management application, but I have at least proved the concept of bringing real-time data to WordPress with WPGraphQL Subscriptions!

The first Subscription I decided to "prove" is a postUpdated subscription. 

The initial concept I wanted to prove was having 2 (or more) clients subscribe to the same postUpdated event, but each requesting different data in response to the event. 

When the post that is subscribed to is updated, each subscribed client should receives a payload with the exact fields they asked for – no more, no less.

I have been able to prove this concept, in a WordPress plugin, only using the traditional WordPress stack (WordPress, PHP, Nginx).

While the demo is exciting to watch, there are for sure a lot of open questions and potential problems. Some might be easily solved, and others I'm less sure about.

How WPGraphQL Subscriptions Work

By time you read this, this information could already be outdated, but below is how things are/were working at the time of writing this.

First, WPGraphQL needs to have "Subscriptions" in the GraphQL Schema. 

add_action( 'graphql_register_types', function() {
    register_graphql_object_type('RootSubscription', [
        'description' => __('Root subscription type. Entry point for all subscriptions.', 'wpgraphql-subscriptions'),
        'fields'      => [],
    ]);

    register_graphql_field('RootSubscription', 'postUpdated', [
        'description' => __('Subscription for post updates.', 'wpgraphql-subscriptions'),
        'type'        => 'Post',
        'args'        => [
            'id' => [
                'type'        => 'ID',
                'description' => __('The ID of the post to subscribe to.', 'wpgraphql-subscriptions'),
            ],
        ],
    ]);
});

add_filter( 'graphql_schema_config', function( $config, $types ) {
    if ( $root = $types->get_type('RootSubscription') ) {
        $config->setSubscription($root);
    }
    return $config;
}, 10, 2 );

Once this code is in place, the postUpdated subscription is available in the GraphQL Schema, and visible in tools such as the GraphiQL IDE, just like Queries and Mutations.

But, just as with Queries and Mutations, adding fields and types to the Schema is only part of the equation. We also need resolvers to handle the event data, and in the case of Subscriptions we also need a way for the client to establish and maintain a long-lived connection to receive data in real-time.

Real-Time Data Transport

The GraphQL specification itself stops short of prescribing how subscription data should be transported in real time. It simply describes some behaviors of Subscriptions (such as only allowing one root subscription field per operation) and leaves the actual implementation details (such as how to handle connections, disconnections, authentication, or message broadcasting) up to each server.

In the GraphQL community, two transport mechanisms have emerged as the most common:

WebSockets: A persistent, bi-directional connection between the client and server, where both can send messages to each other.

Server Sent Events (SSE): A persistent, one-way connection from the server to the client, where the server can stream data to the client as events occur.

While WebSockets are powerful, I don't think WPGraphQL Subscriptions require true two-way communication. The client’s role is simply to subscribe to a specific event, and the server’s role is to push matching data back. SSE is simpler to implement in PHP, works well with HTTP, and I think would reduce the amount of unnecessary traffic and complexity compared to WebSockets.

I did experiment with a WebSocket sidecar server (using GraphQL Yoga acting as a proxy over WPGraphQL) and I also looked at PHP WebSocket libraries like Ratchet, but in the end, I came back to SSE as a simpler, more WordPress-friendly approach. I may, however, visit WebSockets again in the future to really compare. 

Subscription Schema Design

Another thing the GraphQL Specification does not describe, and the greater GraphQL community has not standardized on (that I know of) is how to design a Schema to support subscriptions. 

The GraphQL community helped standardize some parts of Schema design with the Relay spec, which formalizes things like Object Identification (i.e. every unique object is a node) and Pagination (via "connections" and standard first, after, last, before args), but the GraphQL community has not standardized on what a good Subscription schema should look like. 

What should we support in WPGraphQL Subscriptions?

My proof-of-concept has just one subscription: postUpdated. Is that even a good subscription to support? Would it be better to be more granular, such as postTitleUpdated? Or more generic, such as nodeUpdated?

These are some things we'll likely need to explore over time and identify benefits and tradeoffs, and ultimately allow some freedom for specific projects to define their own Subscriptions based on their specific needs. 

Auth and Subscriptions

Scaling Subscriptions is a huge concern of mine. There's a lot of unknowns with how they may scale (or not really scale?). One way to limit the scaling problem could be to limit subscriptions to only authenticated users, at least to start. 

By limiting subscriptions to authenticated users, that reduces the scale issue, as typically (at least in WordPress land) there are often more visitors to public pages than there are visitors to admin pages. The scale needed to support subscriptions on the homepage of WhiteHouse.gov would be a lot different than supporting a Subscription on the wp-admin dashboard of WhiteHouse.gov. 

I'm thinking that we might want to limit Subscriptions to authenticated users to start. Partly to help with possible scaling issues, but also because I think the utility is typically going to be for more collaborative style updates that are usually intended for authenticated users anyway.

Some Challenges so Far

One of the hardest challenges I faced in building the initial implementation was supporting multiple connections to event streams at the same time. 

Out of the box, my local setup (using localwp, which uses php-fpm and nginx) could only handle one connection to a stream and one connection to the wp-admin. Trying to open 2 streams caused things to fall apart. 

This ultimately led me to tinkering with GraphQL Yoga in a NodeJS Sidecar server, as I had convinced myself that PHP simply would not scale as a SSE server.

But I think I jumped to that conclusion too quickly. The MDN docs wouldn't include a PHP example for Server Sent Events if PHP wasn't at least somewhat viable to use PHP as an SSE server. 

So, I set out to give it another shot. It took me a little bit of research and trial and error to get things working, but I was ultimately able to edit my php-fpm and nginx configs and got things to work with several subscriptions (aka event streams) open at the same time. 

I can't say I'm an expert at scaling PHP / nginx for long-lived connections, so I don't yet know what this might look like in real hosting environments, or what would be considered "safe" for large-scale use. I'd love some input here from folks who might have more experience on this topic. Possibly a path like /graphql/stream could be configured in nginx to allow xx number of simultatneous connections and bypass caches, while all other paths (i.e. pretty much the rest of WordPress) have a reduced number of allowed connections and are routed to cached responses as much as possible? 

More Scaling Considerations

From what I've learned so far: 

My setup only works with specific php-fpm and nginx configurations and might not work in many WordPress hosting environments. I've yet to test anywhere but local, so I can't yet say what hosts will or will not support this. 

Reverse proxies and CDNs may buffer or close SSE connections, reducing the utility

Public, anonymous subscriptions will likely be the hardest to scale without a sidecar or managed service

Potential Scaling Paths:

PHP + SSE - this is the simplest deployment. It's a WordPress plugin with some php-fpm and nginx tweaks. Depending how hard it is to scale those aspects, this could work for some sites of a certain scale. 

PHP + Websockets - I've yet to explore this, and there's a chance that perhaps it could scale differently than Server Sent Events. Not sure yet. 

Redis - Using Redis, within WordPress or within a Node sidecar could help with some aspects. For example, in my implementation we're storing subscription documents and an event log in MySQL, where something like Redis could possibly speed things up, and could work interchangeably between PHP and a Node Sidecar server. 

Node.js Sidecar (SSE or Websockets): WordPress triggers a webhook to a sidecar server, which then manages the SSE connections. Theoretically, from what I've read, easier to scale than PHP Server Sent Events, but of course adds complexity. Another service to manage and troubleshoot, etc. Also things like authentication (JWT Tokens? Cookies?) have to be passed through the sidecar service. 

Managed Pub/Sub service (Ably, Pusher, etc) - offloads the real-time messaging, but also adds an external non-oss dependency and cost.