odoo.define('smart_system2.popups', function (require) {
    "use strict";

    //const PopupWidget = require('point_of_sale.popups');
    const PosComponent  = require('point_of_sale.PosComponent');
    const AbstractAwaitablePopup =    require('point_of_sale.AbstractAwaitablePopup');
    const Registries = require('point_of_sale.Registries');
    const ProductItem = require('point_of_sale.ProductItem');
    const ProductScreen = require('point_of_sale.ProductScreen');

    const DataModel = require('web.DataModel');
    const gui     = require('point_of_sale.gui');
    //const db = require('point_of_sale.DB');

    /* ------------- */
    class PayDebtPopupWidget extends AbstractAwaitablePopup {
        constructor() {
            super(...arguments);
        }
        show(options){
        	var self = this;
        	var partners_list = [];
        	self.pay_full_debt = false;
            options = options || {};
            this._super(options);
            $('input#pay_debit_customer').focus();
            self.pos.partners.map(function(partner){
        		partners_list.push({
        			'id':partner.id,
        			'value':partner.name,
        			'label':partner.name,
        		});
        	});
        	$('input#pay_debit_customer').keypress(function(e){
            	$('#pay_debit_customer').autocomplete({
                    source:partners_list,
                    select: function(event, ui) {
                    	self.partner_id = ui.item.id;
                    	var partner = self.pos.db.get_partner_by_id(self.partner_id);
                    	if(partner){
                    		self.pos.get_order().set_client(partner);
                    		if(partner.debt && partner.debt > 0){
                    			self.pay_full_debt = true;
                    			$('#pay_debit_amount').val(partner.debt.toFixed(2));
                    		} else{
                    			self.pay_full_debt = false;
                    			alert("No debit history found for selected customer.");
                    			self.pos.get_order().set_client(false);
                    			$('#pay_debit_amount').val("")
                    		}
                    	}
                    },
                });
        	});
        	$('input#pay_debit_amount').keypress(function(e){
        		if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57)) {
                	return false;
            	}
        	});
        }

        click_confirm(){
        	var self = this;
        	var order = self.pos.get_order();
        	var client = self.pos.get_client();
        	if(self.pay_full_debt){
        		var debt_amount = $('#pay_debit_amount').val();
        		if(debt_amount > 0 && debt_amount <= client.debt){
	        		self.pos.gui.screen_instances.payment.pay_partial_debt(debt_amount);
	    			self.pos.gui.show_screen('payment');
	    			var cashregisters = self.pos.cashregisters;
	    			_.each(cashregisters, function(p_method){
	                    if (p_method.journal.type == "cash" && !p_method.journal.debt) {
	                    	order.add_paymentline(p_method);
	                    	order.selected_paymentline.set_amount(debt_amount);
	                    	self.chrome.screens.payment.reset_input();
	                    	self.chrome.screens.payment.render_paymentlines();
	                    }
	    			});
        		} else{
        			alert("Please enter valid debit amount!");
        			$('#pay_debit_amount').focus();
        		}
        	} else{
        		alert("Something went to wrong!");
        		$('input#pay_debit_customer').focus();
        	}
        }
    }
    PayDebtPopupWidget.template = 'PayDebtPopupWidget';
    Registries.Component.add(PayDebtPopupWidget);
    /* ------------- */
    class AddProductPopup extends AbstractAwaitablePopup {
        renderElement(){
            let namelist = this.pos.db.get_products_name();
            $("#sale_price").keypress(function (e) {
                if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57) && e.which != 46) {
                    return false;
               }
            });
            $("#cost_price").keypress(function (e) {
                if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57) && e.which != 46) {
                    return false;
               }
            });
            $('input#search',this.el).keypress(function(e){
                $('input#search',self.el).autocomplete({
                    source:namelist,
                });
                e.stopPropagation();
            });
        }

        show(options){
            var self = this;
            self.events['click .button.saveclose'] = 'click_saveclose';
            self.events['click .button.savenew'] = 'click_savenew';
            //this._super();
            this.renderElement();
            $('#search').focus();
            this.product_id = 0;
            var res = false;
            var new_options = [];
            var cat_options = [];
            var catg_id;
            $("#sale_price").keypress(function (e) {
                if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57) && e.which != 46) {
                    return false;
               }
            });
            $("#cost_price").keypress(function (e) {
                if (e.which != 8 && e.which != 0 && (e.which < 48 || e.which > 57) && e.which != 46) {
                    return false;
               }
            });
            new_options.push("<option value=''>Select Category</option>");
            var categories = self.pos.db.get_all_categories();
            _.each(categories,function(key,val){
                new_options.push("<option value='"+categories[val].id+"'>"+categories[val].name+"</option>\n");
            });
            $('select.pos_category').html(new_options);

            var internal_cat = self.pos.product_category;
            _.each(internal_cat,function(key,val){
                cat_options.push("<option value='"+internal_cat[val].id+"'>"+internal_cat[val].display_name+"</option>\n");
            });
            $('select.internal_category').html(cat_options);
            $('#search').keyup(function(e){
                var keyword = $.trim($(this).val());
                // if(keyword != null){
                if(keyword){
                    if(e.which == 13){
                        $('span.ui-helper-hidden-accessible').html("");
                        $('ul.ui-autocomplete').css('display', 'none');
                        if(res = self.pos.db.get_product_by_barcode(keyword.length == 12 ? '0'+keyword : keyword)){
                            self.product_id = res.product_tmpl_id;
                        }else if(res = self.pos.db.get_product_by_reference(keyword)){
                            self.product_id = res.product_tmpl_id;
                        }else if(res = self.pos.db.get_product_by_name(keyword)){
                            self.product_id = res.product_tmpl_id;
                        }  else {
                            self.product_id = 0;
                        }
                        if(res){
                            $('table.product-input-table input.name').val(res.display_name);
                            $('table.product-input-table input.sale_price').val(Number(res.list_price).toFixed(2));
                            $('table.product-input-table input.ean13').val(res.barcode != false ? res.barcode : "");
                            $('table.product-input-table input.internal_reference').val(res.default_code != false ? res.default_code : "");
                            $('table.product-input-table input.cost_price').val(Number(res.standard_price).toFixed(2));
                            $('table.product-input-table select.pos_category').val(res.pos_categ_id[0]);
                            $('table.product-input-table select.internal_category').val(res.categ_id[0]);
                        } else {
                            var domain = [['available_in_pos','=',true],'|','|', '|',['barcode', '=', keyword],
                                        ['barcode', '=', '0'+keyword], ['default_code', '=', keyword], ['name', '=', keyword]];
                            new DataModel('product.template').get_func('search_read')(domain,
                            ['display_name','list_price','barcode', 'default_code', 'standard_price', 'pos_categ_id', 'categ_id'])
                            .then(function(product_res){
                                if(product_res.length > 0){
                                    res = product_res[0];
                                    $('table.product-input-table input.name').val(res.display_name);
                                    $('table.product-input-table input.sale_price').val(Number(res.list_price).toFixed(2));
                                    $('table.product-input-table input.ean13').val(res.barcode != false ? res.barcode : "");
                                    $('table.product-input-table input.internal_reference').val(res.default_code != false ? res.default_code : "");
                                    $('table.product-input-table input.cost_price').val(Number(res.standard_price).toFixed(2));
                                    $('table.product-input-table select.pos_category').val(res.pos_categ_id[0]);
                                    $('table.product-input-table select.internal_category').val(res.categ_id[0]);
                                } else {
                                    $('#search').append('<audio src="/point_of_sale/static/src/sounds/error.wav" autoplay="true"></audio>');
                                    if(keyword != ""){
                                            var val = keyword;
                                            $('table.product-input-table input.name').val("");
                                            $('table.product-input-table input.sale_price').val("");
                                            $('table.product-input-table input.ean13').val(val);
                                            $('table.product-input-table input.internal_reference').val(val);
                                            $('table.product-input-table input.cost_price').val('');
                                            $('table.product-input-table input.name').focus();
                                            $('#search').val("");
                                    }else{
                                        alert("invalid search term");
                                    }
                                }
                            });
                        }
                        $(this).val("");
                    }else if(e.which == 8 || e.which == 46){
                        if($(this).val() == ""){
                            self.product_id = 0;
                            $('table.product-input-table input').val("");
                        }
                    }
                }
            });
        }

        click_saveclose(){
            var self = this;
            if(this._save_product(self.product_id)){
                this.gui.close_popup();
            }
        }

        click_savenew(){
            this._save_product(self.product_id);
        }

        click_cancel(){
            this.gui.close_popup();
        }

        _save_product(product_id){
            var self = this;
            var name = $('table.product-input-table input.name').val();
            var list_price = $('table.product-input-table input.sale_price').val();
            var ean13 = $('table.product-input-table input.ean13').val();
            var default_code = $('table.product-input-table input.internal_reference').val();
            var standard_price = $('table.product-input-table input.cost_price').val();
            var pos_categ_id = $('table.product-input-table select.pos_category').val();
            var categ_id = $('table.product-input-table select.internal_category').val();
            if(name != "" && name != undefined && name != null){
                var vals = {
                            "name":name,
                            "list_price":list_price,
                            "barcode":ean13 === "" ? false : ean13,
                            "default_code":default_code,
                            "standard_price":standard_price,
                            "pos_categ_id" : pos_categ_id,
                            "categ_id":categ_id,
                            };
                if(self.product_id <= 0){
                    vals['type'] = 'product';
                    new DataModel("product.template").call("create",[vals]).then(function(res) {
                        if(res){
                            new DataModel('product.product').get_func('search_read')
                            ([['product_tmpl_id', '=', res]], _.find(self.pos.models, function(model){ return model.model === 'product.product'; }).fields)
                            .then(function(product){
                                if(product.length > 0){
                                    product_id = 0;
                                    product[0]["display_name"] =  product[0]['name'];
                                    product[0]["price"] = product[0]['list_price'];

                                    $('table.product-input-table input').val("");
                                    $('table.product-input-table select').val("");
                                    self.pos.db.add_products(product);
                                }
                            });
                        } 
                    }).fail(function (error, event){
                        self.gui.show_popup('error-traceback',{
                              message: error.data.message,
                              comment: error.data.debug
                        });
                    });
                }else{
                    new DataModel("product.template").call("write",[self.product_id,vals]).then(function(res) {
                        if(res){
                            var product_to_update = self.pos.db.get_product_by_tmpl_id(self.product_id);
                            if (product_to_update){
                                product_to_update["name"] =  vals['name'];
                                product_to_update["display_name"] =  vals['name'];
                                product_to_update["price"] = vals['list_price'];
                                product_to_update["list_price"] = vals['list_price'];
                                product_to_update["barcode"] = vals['barcode'];
                                product_to_update["default_code"] = vals['default_code'];
                                product_to_update["standard_price"] = vals['standard_price'];
                                product_to_update["pos_categ_id"] = vals['pos_categ_id'];
                                product_to_update["categ_id"] = vals['categ_id'];
                                $("[data-product-id='"+ product_to_update.id +"']").find('.price-tag').html(self.format_currency(Number(product_to_update["price"]).toFixed(self.pos.currency.decimals)));
                                $("[data-product-id='"+ product_to_update.id +"']").find('.product-name').html(vals['name']);
                                product_id = 0;
                                $('table.product-input-table input').val("");
                                $('table.product-input-table select').val("");
                            }
                        }
                    });
                }
                $('#search').val("");
                return true;
            }else{
                $('table.product-input-table input.name').css('border','thin solid red');
                alert("Product name is required");
                return false;
            }
        }
    }
    AddProductPopup.template = 'AddProductPopup';
    Registries.Component.add(AddProductPopup);
    
    /* ------------- */
    class ProductNotePopupWidget extends AbstractAwaitablePopup {

        show(options){
            options = options || {};
            this._super(options);

            this.renderElement();
            var order    = this.pos.get_order();
            var selected_line = order.get_selected_orderline();
            $('textarea#textarea_note').focus();
            $('textarea#textarea_note').html(selected_line.get_line_note());
        }

        click_confirm(){
            var order    = this.pos.get_order();
            var selected_line = order.get_selected_orderline();
            var value = this.$('#textarea_note').val();
            selected_line.set_line_note(value);
            this.gui.close_popup();
        }

        renderElement() {
            var self = this;
            this._super();
        }
    }
    ProductNotePopupWidget.template = 'ProductNotePopupWidget';
    Registries.Component.add(ProductNotePopupWidget);
    /* ------------- */
    class StockLocationPopup extends AbstractAwaitablePopup {

        show(options){
            options = options || {};
            this._super(options);
            var self = this;
            var value  = self.pos.config.company_id[1];
            new DataModel('stock.location').get_func('search_read')([['company_id', '=', value],['usage', '=', 'internal']],['complete_name'])
            .then(function(result){
                if (result){
                    self.stock_locations = [];
                    _.each(result, function(result_value){
                        self.stock_locations.push(result_value);
                    });
                    self.renderElement();
                }
            });
            this.renderElement();
            var order    = this.pos.get_order();
            var selected_line = order.get_selected_orderline();
            $('#stock_location').focus();
        }

        click_confirm(){
            var self = this;
            var order_container_width = $('.order-container').width();
    		var order_container_height = $('.order-container').height();
            var order    = this.pos.get_order();
            var selected_line = order.get_selected_orderline();
            var id = this.$('#stock_location').val();
            var text = this.$('#stock_location').find(':selected'). text()
            var location = [id,text];
            selected_line.set_stock_location(location);
            self.pos.gui.screen_instances.products.order_widget.renderElement();
            this.gui.close_popup();
            //cart resize code
            $('.order-container').css('width',order_container_width+"px");
            $('.order-container').css('height',order_container_height+"px");
            $('.order-container').resizable();
            $('.order-container').css('z-index','1000');
        	$('.order-container').css('border', '4px solid #6d6b6b');
        	$('.order').css('max-width','100%');
        }

        renderElement() {
            var self = this;
            this._super();
        }
    }
    StockLocationPopup.template = 'StockLocationPopup';
    Registries.Component.add(StockLocationPopup);
    /* ------------- */
    class ProductPopup extends AbstractAwaitablePopup {
        
        show(options){
	    	var self = this;
			this._super();
			this.product_list = options.product_list || "";
			this.order_id = options.order_id || "";
			this.state = options.state || "";
			this.renderElement();
	    }

	    click_confirm(){
	        if (this.state == "paid" || this.state == "done"){
                $( "#re_order_duplicate" ).data("id",self.order_id);
    			$( "#re_order_duplicate" ).trigger("click");
	        } else if(this.state == "draft") {
                $( "#re_order" ).data("id",self.order_id);
                $( "#re_order" ).trigger("click");
			}
			this.gui.close_popup();
	    }
    	click_cancel(){
    		this.gui.close_popup();
    	}
    }

    ProductPopup.template = 'ProductPopup';
    Registries.Component.add(ProductPopup);
    
    /* ------------- */
    return {
        PayDebtPopupWidget,
        AddProductPopup,
        ProductNotePopupWidget,
        StockLocationPopup,
        ProductPopup
    };

});