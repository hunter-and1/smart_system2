odoo.define('smart_system2.db', function (require) {
    "use strict";

    var DB = require('point_of_sale.DB');
    var core = require('web.core');
    var pos_model = require('point_of_sale.models');

    pos_model.load_fields('product.product', 'qty_available');

    var _t = core._t;
    
    DB.include({
        init: function(options){
            this._super.apply(this, arguments);
            this.all_categories = {};
            this.product_by_name = {};
            this.prod_name_list = [];
            this.prod_by_ref = {};
            this.product_by_tmpl_id = [];
            this.product_write_date = null;
            this.group_products = [];
        	this.order_write_date = null;
        	this.order_by_id = {};
        	this.order_sorted = [];
        	this.order_search_string = "";
            this.currency_symbol = {};

        },
        add_categories: function(categories){
            var self = this;
            this.all_categories = categories;
            this._super.apply(this, arguments);
        },
        get_all_categories : function() {
            return this.all_categories;
        },
        add_products: function(products){
            this._super.apply(this, arguments);
            let new_write_date = '';
            let symbol = this.currency_symbol ? this.currency_symbol.symbol : "$";
            for(let i = 0, len = products.length; i < len; i++){
                let product = products[i];
                if ( new_write_date < product.write_date ) {
                    new_write_date  = product.write_date;
                }
                this.product_write_date = new_write_date || this.product_write_date;
                if(product.name){
                    this.product_by_name[product.name] = product
                    this.prod_name_list.push(product.name);
                    this.prod_by_ref[product.default_code] = product;
                    this.product_by_tmpl_id[product.product_tmpl_id] = product;
                }
            }
            for(var i = 0, len = products.length; i < len; i++){
                var product = products[i];
                console.log('\n\n======list', product)
                var unit_name = product.uom_id[1] ? product.uom_id[1] : "";
                if(product['list_price']) {
                    product['price'] = product['list_price']
                    if(product.to_weight){
                        $("[data-product-id='"+product.id+"']").find('.price-tag').html(symbol+" "+product['list_price'].toFixed(2)+'/'+unit_name);
                    } else {
                        $("[data-product-id='"+product.id+"']").find('.price-tag').html(symbol+" "+product['list_price'].toFixed(2));
                    }
                }
                if(product['standard_price']){
                    if(product.to_weight){
                        $("[data-product-id='"+product.id+"']").find('.cost_price-tag').html(symbol+" "+product['standard_price'].toFixed(2)+'/'+unit_name);
                    } else {
                        $("[data-product-id='"+product.id+"']").find('.cost_price-tag').html(symbol+" "+product['standard_price'].toFixed(2));
                    }
                }
                /*
                if(product.to_weight){
                    $("[data-product-id='"+product.id+"']").find('.qty_disp').html(product['qty_available'].toFixed(2)+'/'+unit_name);
                    if(product['qty_available'] < 0){
                        $("[data-product-id='"+product.id+"']").find('.qty_disp').removeClass('product-qty').addClass('product-qty-low');
                    } else {
                        $("[data-product-id='"+product.id+"']").find('.qty_disp').removeClass('product-qty-low').addClass('product-qty');
                    }
                } else {
                    $("[data-product-id='"+product.id+"']").find('.qty_disp').html(product['qty_available'].toFixed(2));
                    if(product['qty_available'] < 0){
                        $("[data-product-id='"+product.id+"']").find('.qty_disp').removeClass('product-qty').addClass('product-qty-low');
                    } else {
                        $("[data-product-id='"+product.id+"']").find('.qty_disp').removeClass('product-qty-low').addClass('product-qty');
                    }
                } */
            }
        },
        get_product_by_name: function(name){
            if(this.product_by_name[name]){
                return this.product_by_name[name];
            }
            return undefined;
        },
        get_products_name: function(name){
            return this.prod_name_list;
        },
        get_product_by_reference: function(ref){
            return this.prod_by_ref[ref];
        },
        get_product_by_tmpl_id: function(id){
            return this.product_by_tmpl_id[id];
        },
        get_product_write_date: function(){
            return this.product_write_date || "1970-01-01 00:00:00";
        },
        notification: function(type, message){
            var types = ['success','warning','info', 'danger'];
            if($.inArray(type.toLowerCase(),types) != -1){
                $('div.span4').remove();
                var newMessage = '';
                message = _t(message);
                switch(type){
                    case 'success' :
                    newMessage = '<i class="fa fa-check" aria-hidden="true"></i> '+message;
                    break;
                    case 'warning' :
                    newMessage = '<i class="fa fa-exclamation-triangle" aria-hidden="true"></i> '+message;
                    break;
                    case 'info' :
                    newMessage = '<i class="fa fa-info" aria-hidden="true"></i> '+message;
                    break;
                    case 'danger' :
                    newMessage = '<i class="fa fa-ban" aria-hidden="true"></i> '+message;
                    break;
                }
                $('body').append('<div class="span4 pull-right">' + '<div class="alert alert-'+type+' fade">' + newMessage+
                '</div>'+
                '</div>');
                $(".alert").removeClass("in").show();
                $(".alert").delay(200).addClass("in").fadeOut(3000);
            }
        },
        add_orders: function(orders){
            var updated_count = 0;
            var new_write_date = '';
            for(var i = 0, len = orders.length; i < len; i++){
                var order = orders[i];
                if (!this.order_by_id[order.id]) {
                    this.order_sorted.push(order.id);
                }
                this.order_by_id[order.id] = order;
                updated_count += 1;
            }
            this.order_write_date = new_write_date || this.order_write_date;
            if (updated_count) {
                // If there were updates, we need to completely
                this.order_search_string = "";
                for (var id in this.order_by_id) {
                    var order = this.order_by_id[id];
                    this.order_search_string += this._order_search_string(order);
                }
            }
            return updated_count;
        },
        _order_search_string: function(order){
            var str =  order.name;
            if(order.pos_reference){
                str += '|' + order.pos_reference;
            }
            str = '' + order.id + ':' + str.replace(':','') + '\n';
            return str;
        },
        get_order_write_date: function(){
            return this.order_write_date;
        },
        get_order_by_id: function(id){
            return this.order_by_id[id];
        },
        search_order: function(query){
            try {
                query = query.replace(/[\[\]\(\)\+\*\?\.\-\!\&\^\$\|\~\_\{\}\:\,\\\/]/g,'.');
                query = query.replace(' ','.+');
                var re = RegExp("([0-9]+):.*?"+query,"gi");
            }catch(e){
                return [];
            }
            var results = [];
            var r;
            for(var i = 0; i < this.limit; i++){
                r = re.exec(this.order_search_string);
                if(r){
                    var id = Number(r[1]);
                    results.push(this.get_order_by_id(id));
                }else{
                    break;
                }
            }
            return results;
        },
    });

});