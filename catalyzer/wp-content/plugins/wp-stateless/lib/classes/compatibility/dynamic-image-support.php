<?php
/**
 * Plugin Name: WP Stateless
 * Plugin URI: https://wordpress.org/plugins/wp-stateless/
 *
 * Compatibility Description: Upload image thumbnails generated by your theme and
 * plugins that do not register media objects with the media library.
 *
 */

namespace wpCloud\StatelessMedia {

    if(!class_exists('wpCloud\StatelessMedia\DynamicImageSupport')) {
        
        class DynamicImageSupport extends ICompatibility {
            protected $id = 'dynamic-image-support';
            protected $title = 'Dynamic Image Support';
            protected $constant = ['WP_STATELESS_MEDIA_ON_FLY' => 'WP_STATELESS_DYNAMIC_IMAGE_SUPPORT'];
            protected $description = 'Upload image thumbnails generated by your theme and plugins that do not register media objects with the media library.';
            protected $first_party = true;

            public function __construct(){
                $modules = get_option('stateless-modules', array());

                if (empty($modules[$this->id])) {
                    // Legacy settings
                    $this->enabled = get_option('sm_on_fly', false);
                }

                $this->init();
            }

            public function module_init($sm){

                /**
                 * Handle any other on fly generated media
                 * 7d23984e     Anton Korotkov, 2 years ago   (February 19th, 2016 9:02am) new options added
                 */
                add_filter('image_make_intermediate_size', array($this, 'handle_on_fly'));
            }

            /**
             * Handle images on fly
             * f6a7dfd9 Anton Korotkov, 2 years ago (September 29th, 2015 6:09am)
             * @param $file
             * @return mixed
             */
            public function handle_on_fly( $file ) {

                $client = ud_get_stateless_media()->get_client();
                $upload_dir = wp_upload_dir();

                $file_path = str_replace(trailingslashit($upload_dir[ 'basedir' ]), '', $file);
                $file_info = @getimagesize($file);
                $mimeType = wp_check_filetype($file);

                if ($file_info) {
                    $_metadata = array(
                        'width'  => $file_info[0],
                        'height' => $file_info[1],
                        'object-id' => 'unknown', // we really don't know it
                        'source-id' => md5( $file . ud_get_stateless_media()->get( 'sm.bucket' ) ),
                        'file-hash' => md5( $file )
                    );
                }

                $client->add_media(apply_filters('sm:item:on_fly:before_add', array_filter(array(
                    'name' => $file_path,
                    'absolutePath' => wp_normalize_path($file),
                    'cacheControl' => apply_filters('sm:item:cacheControl', 'public, max-age=36000, must-revalidate', $_metadata),
                    'contentDisposition' => null,
                    'mimeType' => $mimeType['type'],
                    'metadata' => $_metadata
                ))));

                return $file;
            }

        }

    }

}