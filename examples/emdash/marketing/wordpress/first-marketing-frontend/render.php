<?php
declare(strict_types=1);
namespace FirstMarketing;
if (!defined('ABSPATH')) exit;
$identity = $site['identity'] ?? [];
$siteTitle = trim($identity['title'] ?? '') ?: 'My Site';
$sections = $page['sections'] ?? [];
$hero = null;
foreach ($sections as $s) if ($s['layout'] === 'hero') { $hero = $s; break; }
$seo = $page['seo'] ?? [];
$title = ($seo['title'] ?? '') ?: ($path === '' ? $siteTitle : ($page['title'] ?? 'Page not found'));
$fullTitle = str_contains($title, $siteTitle) ? $title : $title . ' ' . ($site['seo']['titleSeparator'] ?? '—') . ' ' . $siteTitle;
$description = ($seo['description'] ?? '') ?: ($hero['subheadline'] ?? ($identity['tagline'] ?? ''));
$ogImage = ($seo['image'] ?? null) ?: ($hero['image'] ?? null);
$navigation = $site['navigation'] ?? [];
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= text($fullTitle) ?></title>
<meta name="description" content="<?= esc_attr($description) ?>">
<meta property="og:title" content="<?= esc_attr($fullTitle) ?>"><meta property="og:description" content="<?= esc_attr($description) ?>"><meta property="og:type" content="website">
<?php if ($ogImage): ?><meta property="og:image" content="<?= href(wp_get_attachment_url((int) $ogImage)) ?>"><?php endif ?>
<link rel="canonical" href="<?= href(home_url($path === '' ? '/' : '/' . $path)) ?>">
<?php if (!empty($seo['noindex']) || $preview): ?><meta name="robots" content="noindex,nofollow"><?php endif ?>
<?php wp_head() ?>
<link rel="stylesheet" href="<?= href(plugins_url('style.css', __FILE__)) ?>">
<script src="<?= href(plugins_url('theme.js', __FILE__)) ?>" defer></script>
</head><body <?php body_class('marketing-site') ?>>
<?php wp_body_open() ?>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><a class="wordmark" href="<?= href(home_url('/')) ?>"><?php if (!empty($identity['logo'])) echo wp_get_attachment_image((int) $identity['logo'], 'medium', false, ['alt' => $siteTitle]); else echo text($siteTitle); ?></a>
<nav class="desktop-nav" aria-label="Primary"><?php foreach ($navigation as $item): ?><a class="<?= !empty($item['button']) ? 'button' : '' ?>" href="<?= href($item['href']) ?>"><?= text($item['label']) ?></a><?php endforeach ?></nav>
<details class="mobile-nav"><summary>Menu</summary><nav aria-label="Mobile"><?php foreach ($navigation as $item): ?><a href="<?= href($item['href']) ?>"><?= text($item['label']) ?></a><?php endforeach ?></nav></details>
<?php if (current_user_can('edit_others_posts')): ?><a href="<?= href(admin_url()) ?>">Admin</a><?php endif ?></header>
<main id="main" tabindex="-1">
<?php if ($preview): ?><p class="preview-note">Draft preview</p><?php endif ?>
<?php if ($page): ?>
<?php if (!$hero): ?><header class="page-header"><h1><?= text($path === '' ? $siteTitle : $page['title']) ?></h1></header><?php endif ?>
<?php foreach ($sections as $i => $s) section($s, $i); ?>
<?php elseif ($path === ''): ?><section class="section hero"><h1><?= text($siteTitle) ?></h1><p class="lead"><?= text($identity['tagline'] ?? '') ?></p></section>
<?php else: ?><section class="section hero"><p class="eyebrow">404</p><h1>Page not found</h1><p>This room is empty. The page you’re looking for doesn’t exist or has moved.</p><?php button('Go home', home_url('/')); ?></section><?php endif ?>
</main>
<footer class="site-footer"><div class="footer-intro"><a class="wordmark" href="<?= href(home_url('/')) ?>"><?= text($siteTitle) ?></a><p><?= text($identity['tagline'] ?? '') ?></p></div>
<?php foreach ($site['footer'] ?? [] as $column): ?><nav aria-label="<?= esc_attr($column['heading']) ?>"><h2><?= text($column['heading']) ?></h2><?php foreach ($column['links'] ?? [] as $link): ?><a href="<?= href($link['href']) ?>"><?= text($link['label']) ?></a><?php endforeach ?></nav><?php endforeach ?>
<div class="footer-bottom"><small>© <?= date('Y') ?> <?= text($siteTitle) ?></small><div class="theme-switcher" role="group" aria-label="Color theme"><?php foreach (['light','dark','system'] as $theme): ?><button type="button" data-theme="<?= $theme ?>" aria-pressed="false"><?= ucfirst($theme) ?></button><?php endforeach ?></div></div></footer>
<?php wp_footer() ?>
</body></html>
