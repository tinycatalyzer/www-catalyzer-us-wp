# https://github.com/docker-library/wordpress/blob/9ee913eea382b5d79f852a2301d4390904d2e4d2/php7.3/apache/Dockerfile
FROM wordpress:5.7-php7.4-apache

# wordpress conf
WORKDIR /var/www/html
COPY ./catalyzer/wp-config.php /var/www/html/wp-config.php
COPY ./catalyzer/wp-content /var/www/html/wp-content

EXPOSE 80