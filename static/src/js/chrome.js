odoo.define('smart_system2.chrome', function (require) {
    var chrome = require('point_of_sale.chrome');
    chrome.Chrome.include({
    	build_widgets: function(){
            var self = this;
            this._super();
            $('.order-container').resizable();
            $('.order-container').mousedown(function() {
            	$('.order-container').css('z-index','1000');
            	$('.order-container').css('border', '4px solid #6d6b6b');
            	$('.order').css('max-width','100%');
            });
    	},
    });
});