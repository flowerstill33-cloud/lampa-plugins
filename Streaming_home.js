(function () {
  'use strict';

  // Streaming Home: подборки по онлайн-кинотеатрам (Netflix, Apple TV+, Disney+ ...)
  // Источник данных: TMDB. Пункт «Стриминги» добавляется в левое меню Lampa.

  var SERVICES = [
    { name: 'Netflix',      network: 213,  provider: 8 },
    { name: 'Apple TV+',    network: 2552, provider: 350 },
    { name: 'Disney+',      network: 2739, provider: 337 },
    { name: 'Amazon Prime', network: 1024, provider: 119 },
    { name: 'HBO / Max',    network: 49,   provider: 1899 },
    { name: 'Hulu',         network: 453,  provider: 15 },
    { name: 'Paramount+',   network: 4330, provider: 531 },
    { name: 'Peacock',      network: 3353, provider: 386 }
  ];

  var REGIONS = { US: 'США', GB: 'Великобритания', DE: 'Германия', FR: 'Франция', PL: 'Польша', TR: 'Турция', UA: 'Украина', KZ: 'Казахстан' };

  function region() {
    return Lampa.Storage.get('streaming_region', 'US');
  }

  function lang() {
    return Lampa.Storage.field('tmdb_lang') || Lampa.Storage.get('language', 'ru') || 'ru';
  }

  function lines() {
    var list = [];
    var r = region();
    var today = new Date().toISOString().slice(0, 10);

    SERVICES.forEach(function (s) {
      list.push({
        title: s.name + ' — сериалы',
        url: 'discover/tv?with_networks=' + s.network + '&sort_by=popularity.desc&vote_count.gte=30',
        type: 'tv'
      });
      list.push({
        title: s.name + ' — фильмы',
        url: 'discover/movie?with_watch_providers=' + s.provider + '&watch_region=' + r +
          '&with_watch_monetization_types=flatrate&sort_by=popularity.desc&vote_count.gte=50',
        type: 'movie'
      });
      list.push({
        title: s.name + ' — новинки',
        url: 'discover/tv?with_networks=' + s.network + '&sort_by=first_air_date.desc&first_air_date.lte=' + today + '&vote_count.gte=5',
        type: 'tv',
        kind: 'new'
      });
    });

    return list;
  }

  var last_error = '';

  function request(url, ok, fail) {
    var key = (Lampa.TMDB && typeof Lampa.TMDB.key === 'function') ? Lampa.TMDB.key() : '';
    var full = Lampa.TMDB.api(url + (url.indexOf('?') > -1 ? '&' : '?') + 'api_key=' + key + '&language=' + lang());
    var net = new Lampa.Reguest();

    net.silent(full, ok, function (a, b) {
      last_error = (a && a.status ? a.status : '') + ' ' + (b || '');
      fail && fail();
    });
  }

  function Streaming(object) {
    var comp = new Lampa.InteractionMain(object);

    comp.create = function () {
      var _this = this;
      var defs = lines();
      var slots = new Array(defs.length);
      var left = defs.length;

      this.activity.loader(true);

      var finish = function () {
        left--;
        if (left > 0) return;

        var data = slots.filter(Boolean);

        if (data.length) _this.build(data);
        else {
          if (last_error) Lampa.Noty.show('Стриминги: ошибка запроса TMDB (' + last_error.trim() + ')');
          _this.empty();
        }

        _this.activity.loader(false);
      };

      defs.forEach(function (def, i) {
        request(def.url, function (json) {
          if (json && json.results && json.results.length) {
            json.results.forEach(function (card) {
              if (!card.media_type) card.media_type = def.type;
            });

            slots[i] = {
              title: def.title,
              results: json.results,
              url: def.url,
              source: 'tmdb',
              page: 1,
              more: true
            };
          }
          finish();
        }, finish);
      });

      return this.render();
    };

    return comp;
  }

  // ---------- Ряды на главной ----------

  function mainMode() {
    return Lampa.Storage.get('streaming_main_mode', 'both');
  }

  function activeOnMain(def) {
    var mode = mainMode();
    if (!def || mode == 'off' || def.kind == 'new') return false;
    return mode == 'both' || (mode == 'series' && def.type == 'tv') || (mode == 'movies' && def.type == 'movie');
  }

  function makeLine(def, json) {
    if (!json || !json.results || !json.results.length) return null;

    json.results.forEach(function (card) {
      if (!card.media_type) card.media_type = def.type;
    });

    return {
      title: def.title,
      results: json.results,
      url: def.url,
      source: 'tmdb',
      page: 1,
      more: true
    };
  }

  function hookMain() {
    // Новые версии Lampa: официальный API рядов
    if (Lampa.ContentRows && typeof Lampa.ContentRows.add === 'function') {
      lines().forEach(function (base, i) {
        Lampa.ContentRows.add({
          index: i + 1,
          name: 'streaming_row_' + i,
          title: base.title,
          screen: ['main'],
          call: function () {
            var def = lines()[i];
            if (!activeOnMain(def)) return;

            return function (callback) {
              request(def.url, function (json) {
                var line = makeLine(def, json);
                callback(line || {});
              }, function () {
                callback({});
              });
            };
          }
        });
      });
      return;
    }

    // Старые версии: добавляем ряды в ответ Lampa.Api.sources.tmdb.main
    var tmdb = Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb;
    if (!tmdb || typeof tmdb.main !== 'function') return;

    var original = tmdb.main;

    tmdb.main = function (params, oncomplite, onerror) {
      var added = false;

      return original.call(this, params, function (data) {
        if (added || !Array.isArray(data)) return oncomplite(data);
        added = true;

        var defs = lines().filter(activeOnMain);
        var slots = new Array(defs.length);
        var left = defs.length;

        if (!left) return oncomplite(data);

        var done = function () {
          left--;
          if (left > 0) return;
          slots.filter(Boolean).forEach(function (line, n) {
            data.splice(Math.min(1 + n, data.length), 0, line);
          });
          oncomplite(data);
        };

        defs.forEach(function (def, i) {
          request(def.url, function (json) {
            slots[i] = makeLine(def, json);
            done();
          }, done);
        });
      }, onerror);
    };
  }

  function addMenu() {
    if ($('.menu .menu__list [data-action="streaming_home"]').length) return;

    var item = $(
      '<li class="menu__item selector" data-action="streaming_home">' +
        '<div class="menu__ico">' +
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M10 8.5L15 11L10 13.5V8.5Z" fill="currentColor"/>' +
            '<rect x="7" y="20" width="10" height="2" rx="1" fill="currentColor"/>' +
          '</svg>' +
        '</div>' +
        '<div class="menu__text">Стриминги</div>' +
      '</li>'
    );

    item.on('hover:enter', function () {
      Lampa.Activity.push({
        url: '',
        title: 'Стриминги',
        component: 'streaming_main',
        page: 1
      });
    });

    $('.menu .menu__list').eq(0).append(item);
  }

  function startPlugin() {
    if (window.streaming_home_ready) return;
    window.streaming_home_ready = true;

    Lampa.Component.add('streaming_main', Streaming);

    Lampa.SettingsApi.addComponent({
      component: 'streaming_home',
      name: 'Стриминги',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="14" rx="2" stroke="white" stroke-width="2"/><path d="M10 8.5L15 11L10 13.5V8.5Z" fill="white"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: 'streaming_home',
      param: {
        name: 'streaming_region',
        type: 'select',
        values: REGIONS,
        default: 'US'
      },
      field: {
        name: 'Регион каталога',
        description: 'Влияет на подборки фильмов (доступность по странам)'
      }
    });

    Lampa.SettingsApi.addParam({
      component: 'streaming_home',
      param: {
        name: 'streaming_main_mode',
        type: 'select',
        values: { both: 'Сериалы и фильмы', series: 'Только сериалы', movies: 'Только фильмы', off: 'Не показывать' },
        default: 'both'
      },
      field: {
        name: 'Подборки на главной',
        description: 'Какие ряды стримингов показывать на главной (применится после перезагрузки)'
      }
    });

    hookMain();
    addMenu();
  }

  if (window.appready) startPlugin();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type == 'ready') startPlugin();
    });
  }
})();
