/*
 * Copyright 2019 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

'use strict';

import Koa from 'koa';
import koaCompress from 'koa-compress';
import request from 'supertest';
import route from 'koa-route';

import { MemoryCache } from '../memory-cache';
import test, { ExecutionContext } from 'ava';

const app = new Koa();
const server = request(app.listen());
const cache = new MemoryCache();

app.use(route.get('/compressed', koaCompress()));

app.use(cache.middleware());

let handlerCalledCount = 0;

test.before(async () => {
  handlerCalledCount = 0;
  await cache.clearCache();
});

app.use(
  route.get('/', (ctx: Koa.Context) => {
    handlerCalledCount++;
    ctx.body = `Called ${handlerCalledCount} times`;
  })
);

const promiseTimeout = function (timeout: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
};

test('caches content and serves same content on cache hit', async (t: ExecutionContext) => {
  const previousCount = handlerCalledCount;
  let res = await server.get('/?basictest');
  t.is(res.status, 200);
  t.is(res.text, 'Called ' + (previousCount + 1) + ' times');

  // Workaround for race condition with writing to datastore.
  await promiseTimeout(500);

  res = await server.get('/?basictest');
  t.is(res.status, 200);
  t.is(res.text, 'Called ' + (previousCount + 1) + ' times');
  t.truthy(res.header['x-rendertron-cached']);
  t.true(new Date(res.header['x-rendertron-cached']) <= new Date());

  res = await server.get('/?basictest');
  t.is(res.status, 200);
  t.is(res.text, 'Called ' + (previousCount + 1) + ' times');
});

app.use(
  route.get('/set-header', (ctx: Koa.Context) => {
    ctx.set('my-header', 'header-value');
    ctx.body = 'set-header-payload';
  })
);

test('caches headers', async (t: ExecutionContext) => {
  let res = await server.get('/set-header');
  t.is(res.status, 200);
  t.is(res.header['my-header'], 'header-value');
  t.is(res.text, 'set-header-payload');

  // Workaround for race condition with writing to datastore.
  await promiseTimeout(500);

  res = await server.get('/set-header');
  t.is(res.status, 200);
  t.is(res.header['my-header'], 'header-value');
  t.is(res.text, 'set-header-payload');
});

app.use(
  route.get('/compressed', (ctx: Koa.Context) => {
    ctx.set('Content-Type', 'text/html');
    ctx.body = new Array(1025).join('x');
  })
);

test('compression preserved', async (t: ExecutionContext) => {
  const expectedBody = new Array(1025).join('x');
  let res = await server
    .get('/compressed')
    .set('Accept-Encoding', 'gzip, deflate');
  t.is(res.status, 200);
  t.is(res.header['content-encoding'], 'gzip');
  t.is(res.text, expectedBody);

  // Workaround for race condition with writing to datastore.
  await promiseTimeout(500);

  res = await server.get('/compressed').set('Accept-Encoding', 'gzip, deflate');
  t.is(res.status, 200);
  t.is(res.header['content-encoding'], 'gzip');
  t.is(res.text, expectedBody);
});

let statusCallCount = 0;
app.use(
  route.get('/status/:status', (ctx: Koa.Context, status: string) => {
    // Every second call sends a different status.
    if (statusCallCount % 2 === 0) {
      ctx.status = Number(status);
    } else {
      ctx.status = 401;
    }
    statusCallCount++;
  })
);

test('original status is preserved', async (t: ExecutionContext) => {
  let res = await server.get('/status/400');
  t.is(res.status, 400);

  // Non 200 status code should not be cached.
  res = await server.get('/status/400');
  t.is(res.status, 401);
});

test('cache entry can be removed', async (t: ExecutionContext) => {
  let counter = 0;
  app.use(
    route.get('/removalTest', (ctx: Koa.Context) => {
      ctx.body = `Counter: ${++counter}`;
    })
  );

  let res = await server.get('/?cacheremovetest');
  t.is(res.status, 200);
  t.falsy(res.header['x-rendertron-cached']);
  t.false(new Date(res.header['x-rendertron-cached']) <= new Date());

  res = await server.get('/?cacheremovetest');

  t.is(res.status, 200);
  t.truthy(res.header['x-rendertron-cached']);
  t.true(new Date(res.header['x-rendertron-cached']) <= new Date());

  cache.removeEntry('/?cacheremovetest');
  res = await server.get('/?cacheremovetest');
  t.is(res.status, 200);
  t.falsy(res.header['x-rendertron-cached']);
  t.false(new Date(res.header['x-rendertron-cached']) <= new Date());

  res = await server.get('/?cacheremovetest');
  t.is(res.status, 200);
  t.truthy(res.header['x-rendertron-cached']);
  t.true(new Date(res.header['x-rendertron-cached']) <= new Date());
});

test('refreshCache refreshes cache', async (t: ExecutionContext) => {
  let content = 'content';
  app.use(
    route.get('/refreshTest', (ctx: Koa.Context) => {
      ctx.body = content;
    })
  );

  let res = await server.get('/refreshTest');
  t.is(res.status, 200);
  t.is(res.text, 'content');

  // Workaround for race condition with writing to datastore.
  await promiseTimeout(500);

  res = await server.get('/refreshTest');
  t.truthy(res.header['x-rendertron-cached']);
  t.is(res.text, 'content');

  content = 'updated content';

  res = await server.get('/refreshTest?refreshCache=true');
  t.is(res.status, 200);
  t.is(res.text, 'updated content');
  t.is(res.header['x-rendertron-cached'], '');
});

test.serial('clear all memory cache entries', async (t: ExecutionContext) => {
  app.use(
    route.get('/clear-all-cache', (ctx: Koa.Context) => {
      ctx.body = 'Foo';
    })
  );

  await server.get('/clear-all-cache?cachedResult1');
  await server.get('/clear-all-cache?cachedResult2');

  let res = await server.get('/clear-all-cache?cachedResult1');
  t.is(res.status, 200);
  t.truthy(res.header['x-rendertron-cached']);
  t.true(new Date(res.header['x-rendertron-cached']) <= new Date());
  res = await server.get('/clear-all-cache?cachedResult2');
  t.is(res.status, 200);
  t.truthy(res.header['x-rendertron-cached']);
  t.true(new Date(res.header['x-rendertron-cached']) <= new Date());

  cache.clearCache();

  res = await server.get('/clear-all-cache?cachedResult1');
  t.is(res.status, 200);
  t.falsy(res.header['x-rendertron-cached']);
  t.false(new Date(res.header['x-rendertron-cached']) <= new Date());
  res = await server.get('/clear-all-cache?cachedResult2');
  t.is(res.status, 200);
  t.falsy(res.header['x-rendertron-cached']);
  t.false(new Date(res.header['x-rendertron-cached']) <= new Date());
});
