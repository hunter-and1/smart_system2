odoo.define('smart_system2.models', function (require) {
    "use strict";

    const pos_model = require('point_of_sale.models');
    const Model     = require('web.Model');
    const utils     = require('web.utils');
    //var Models = require('web.DataModel');
    //var db = require('point_of_sale.DB');

    const round_pr = utils.round_precision;

    pos_model.load_models({
        model: 'product.pricelist',
        fields: [],
        context: [['type', '=', 'sale']],
        loaded: function(self, prod_pricelists){
            self.prod_pricelists = [];
            self.prod_pricelists = prod_pricelists;
        },
    });
    
    pos_model.load_models({
        model:  'product.category',
        fields: ['id','display_name'],
        domain: null,
        loaded: function(self, product_category){

            self.product_category = [];
            self.product_category = product_category;
        },
    });
    pos_model.load_fields("res.partner", ['property_product_pricelist']);
    pos_model.load_fields("res.users", ['default_pos']);
    pos_model.load_fields("product.product", ['categ_id','standard_price','name','taxes_id','qty_available', 'write_date'] );

    var _modelproto = pos_model.PosModel.prototype;
    pos_model.PosModel = pos_model.PosModel.extend({
    	initialize: function (session, attributes) {
            this.reload_debts_partner_ids = [];
            this.reload_debts_ready = $.when();
            var partner_model = _.find(this.models, function(model){ return model.model === 'res.partner'; });
            partner_model.fields.push('debt_type', 'debt', 'debt_limit');
            var journal_model = _.find(this.models, function(model){ return model.model === 'account.journal'; });
            journal_model.fields.push('debt');
            var product_model = _.find(this.models, function(model){ return model.model === 'product.product'; });
            product_model.fields.push('credit_product');
            return _modelproto.initialize.call(this, session, attributes);
        },
        _save_to_server: function (orders, options) {
            var self = this;
            var def = _modelproto._save_to_server.call(this, orders, options);
            def.then(function(server_ids){
                if(server_ids.length > 0){
                    self.order_to_print = server_ids[server_ids.length - 1];
                    new Model('pos.order').get_func('ac_pos_search_read')([['id','in',server_ids]])
                    .then(function(orders){
                        var orders_data= self.get('pos_order_list');
                        var new_orders = [];
                        var flag = true;
                        if(orders && orders[0]){
                            for(var i in orders_data){
                                if(orders_data[i].pos_reference == orders[0].pos_reference){
                                    new_orders.push(orders[0])
                                    flag = false
                                } else {
                                    new_orders.push(orders_data[i])
                                }
                            }
                            if(flag){
                                new_orders = orders.concat(orders_data);
                            }
                         self.db.add_orders(new_orders);
                            self.set({'pos_order_list' : new_orders});
                        } else {
                            new_orders = orders.concat(orders_data);
                         self.db.add_orders(new_orders);
                            self.set({'pos_order_list' : new_orders});
                        }
                    });
                }
            })
            var partner_ids = [];
            orders.forEach(function(o) {
                if (o.data.updates_debt && o.data.partner_id)
                    partner_ids.push(o.data.partner_id);
            });
            partner_ids = partner_ids.filter((value, index, self) => {
                return self.indexOf(value) === index;
            });
            if (partner_ids.length){
                return def.then(function(server_ids){
                    self.reload_debts(partner_ids);
                    return server_ids;
                });
            }else{
                return def;
            }
        },
        reload_debts: function(partner_ids, limit, options){

            var self = this;
            // function is called whenever we need to update debt value from server
            if (typeof limit === "undefined"){
                limit = 0;
            }
            options = options || {};
            if (typeof options.postpone === "undefined"){
                options.postpone = true;
            }
            if (typeof options.shadow === "undefined"){
                options.shadow = true;
            }

            this.reload_debts_partner_ids = this.reload_debts_partner_ids.concat(partner_ids);
            if (options.postpone && this.reload_debts_ready.state() == 'resolved'){
                // add timeout to gather requests before reloading
                var def = $.Deferred();
                this.reload_debts_ready = def;
                setTimeout(function(){
                    def.resolve();
                }, 1000);
            }
            this.reload_debts_ready = this.reload_debts_ready.then(function(){
                if (self.reload_debts_partner_ids.length > 0) {
                    var load_partner_ids = _.uniq(self.reload_debts_partner_ids.splice(0));
                    var new_partners = _.any(load_partner_ids, function(id){
                        return !self.db.get_partner_by_id(id);
                    });
                    var def;
                    if (new_partners){
                        def = self.load_new_partners();
                    }else{
                        def = $.when();
                    }
                    return def.then(function(){
                        var request_finished = $.Deferred();

                        self._load_debts(load_partner_ids, limit, options).then(function (data) {
                            // success
                            self._on_load_debts(data);
                        }).always(function(){
                            // allow to do next call
                            request_finished.resolve();
                        }).fail(function () {
                            // make request again
                            self.reload_debts(load_partner_ids, 0, {"postpone": true, "shadow": false});
                        });
                        return request_finished;
                    });
                }
            });
            return this.reload_debts_ready;
        },
         _load_debts: function(partner_ids, limit, options){
            return new Model('res.partner').call('debt_history', [partner_ids], {'limit': limit}, {'shadow': options.shadow});
        },
        _on_load_debts: function(debts){
            var partner_ids = _.map(debts, function(debt){ return debt.partner_id; });
            for (var i = 0; i < debts.length; i++) {
                    var partner = this.db.get_partner_by_id(debts[i].partner_id);
                    partner.debt = debts[i].debt;
                    partner.records_count = debts[i].records_count;
                    partner.history = debts[i].history;
                }
                this.trigger('updateDebtHistory', partner_ids);
        },
        delete_current_order: function(){
    		_modelproto.delete_current_order.call(this);
            var order = this.get_order();
            $('#price_list').val(order.get_pricelist());
        },
        set_order: function(order){
        	_modelproto.set_order.call(this, order);
        	var order = this.get_order();
        	if(order.get_client()){
                order.set_pricelist_val(order.get_client().id);
                $('#price_list').val(order.get_pricelist());
            } else {
                $('#price_list').val('');
            }
        },
        add_new_order: function(){
        	var res = _modelproto.add_new_order.call(this);
        	var order = this.get_order();
        	if(order.get_client()){
                order.set_pricelist_val(order.get_client().id);
                $('#price_list').val(order.get_pricelist());
            } else {
                $('#price_list').val('');
            }
            return res;
        },
        load_new_products: function(currency_symbol){
            var self = this;
            var def  = new $.Deferred();
            var fields =self.prod_model ? self.prod_model.fields : [];
                new Model('product.product').get_func('get_last_updated_product')(fields, self.db.get_product_write_date())
                .then(function(products){
                    self.db.currency_symbol = currency_symbol;
                    if (self.db.add_products(products)) {
                        product_list_obj.renderElement(self);
                        def.resolve();
                    } else {
                        def.reject();
                    }
                }, function(err,event){ event.preventDefault(); def.reject(); });    
            return def;
        },
        load_server_data: function(){
			var self = this;
            _.each(this.models, function(model){
                if (model && model.model === 'product.product'){
                    self.prod_model = model;
                }
            });
			var loaded = _modelproto.load_server_data.call(this);
			loaded = loaded.then(function(){
				var date = new Date();
				var start_date;
                if(self.config.last_days){
                    date.setDate(date.getDate() - self.config.last_days);
                }
                start_date = date.toJSON().slice(0,10);
                var domain =['create_date','>=',start_date];
    			return new Model('pos.order').get_func('ac_pos_search_read')([['state','not in',['cancel']],domain])
                .then(function(orders){
                	self.db.add_orders(orders);
                    self.set({'pos_order_list' : orders});
                });
			});
			return loaded;
		},
    });

    var _super_order = pos_model.Order.prototype;
    pos_model.Order = pos_model.Order.extend({
        initialize: function (session, attributes) {
            this.on('change:client', function(){
                var client = this.get_client();
                if (client)
                    this.pos.reload_debts([client.id], 0, {"postpone": false});
            }, this);
            this.set({
                edit_pos_order: false,
                draft_order: false,
            })
            return _super_order.initialize.call(this, session, attributes);
        },

        updates_debt: function(){
            // wheither order update debt value
            return this.has_credit_product() || this.has_debt_journal();
        },
        has_debt_journal: function(){
            return this.paymentlines.any(function(line){
                    return line.cashregister.journal.debt;
                });
        },
        has_credit_product: function(){
            return this.orderlines.any(function(line){
                return line.product.credit_product;
            });
        },
        get_debt_delta: function(){
            var debt_amount = 0;
            var plines = this.get_paymentlines();
            for (var i = 0; i < plines.length; i++) {
                if (plines[i].cashregister.journal.debt) {
                    debt_amount += plines[i].amount;
                }
            }
            this.orderlines.each(function(line){
                if (line.product.credit_product){
                    debt_amount -= line.get_price_without_tax();
                }
            });
            return debt_amount;
        },
        add_paymentline: function(cashregister) {
            this.assert_editable();
            var self = this;
            var journal = cashregister.journal;
            if (!this.get_client() && (this.has_credit_product() || journal.debt)){
                setTimeout(function(){
                    self.pos.gui.show_screen('clientlist');
                }, 30);
            }
            var newPaymentline = new pos_model.Paymentline({},{order: this, cashregister: cashregister, pos: this.pos});
            if (cashregister.journal.debt){
                newPaymentline.set_amount(this.get_due_debt());
            } else if (cashregister.journal.type !== 'cash' || this.pos.config.iface_precompute_cash){
                newPaymentline.set_amount(this.get_due());
            }
            this.paymentlines.add(newPaymentline);
            this.select_paymentline(newPaymentline);
        },
        get_due_debt: function(paymentline) {
            var due = this.get_total_with_tax() - this.get_total_paid();
            if (paymentline) {
                due = this.get_total_with_tax();
                var lines = this.paymentlines.models;
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i] === paymentline) {
                        break;
                    } else {
                        due -= lines[i].get_amount();
                    }
                }
            }
            return round_pr(due, this.pos.currency.rounding);
        },
        set_pricelist_val: function(client_id) {
            var self = this;
            if (client_id) {
                new Model("res.partner").get_func("read")(parseInt(client_id), ['property_product_pricelist']).pipe(
                    function(result) {
                        if (result && result[0].property_product_pricelist) {
                            self.set('pricelist_val', result[0].property_product_pricelist[0] || '');
                            $('#price_list').val(result[0].property_product_pricelist[0]);
                        }
                    }
                );
            }
        },
        get_pricelist: function() {
            return this.get('pricelist_val');
        },
    	add_product: function(product, options){
    	    var self = this;
    		var order_container_width = $('.order-container').width();
    		var order_container_height = $('.order-container').height();
            var partner = this.get_client();
    	    var pricelist_id = parseInt($('#price_list').val()) || this.get_pricelist();
    		if(this._printed){
    	        this.destroy();
    	        return this.pos.get_order().add_product(product, options);
    	    }
    	    this.assert_editable();
    	    options = options || {};
    	    var attr = JSON.parse(JSON.stringify(product));
    	    attr.pos = this.pos;
    	    attr.order = this;
    	    var line = new pos_model.Orderline({}, {pos: this.pos, order: this, product: product});
            line.set_stock_location(this.pos.config.stock_location_id);
            if (self.pos.config.enable_show_cost_price){
                if (line.get_unit_price() < line.product.standard_price){
                    self.pos.db.notification('info','Sale price is less then cost price!');
                     $('.pos .order .orderline').css("background","#F57D7D");
                }
            } 

    	    if(options.quantity !== undefined){
    	        line.set_quantity(options.quantity);
    	    }
    	    if(options.price !== undefined){
                line.set_unit_price(options.price);
    	    }
    	    if(options.discount !== undefined){
    	        line.set_discount(options.discount);
    	    }
    	
    	    if(options.extras !== undefined){
    	        for (var prop in options.extras) { 
    	            line[prop] = options.extras[prop];
    	        }
    	    }
    	    var last_orderline = this.get_last_orderline();
    	    if( last_orderline && last_orderline.can_be_merged_with(line) && options.merge !== false){
    	        last_orderline.merge(line);
    	        if (self.pos.config.enable_pricelist){
                    if(partner){
        	        	if(pricelist_id){
        	        		var qty = last_orderline.get_quantity();
        	        		new Model("product.pricelist").get_func('price_get')([pricelist_id], product.id, qty).pipe(
                                function(res){
                                    if (res[pricelist_id]) {
                                        var pricelist_value = parseFloat(res[pricelist_id].toFixed(2));
                                        if (pricelist_value) {
                                            last_orderline.set_unit_price(pricelist_value);
                                        }
                                    }
                                }
                            );
        	        	}
        		    }
                }
    	    } else {
    	    	//var pricelist_value = null;
                if (self.pos.config.enable_pricelist){
                    if (partner) {
                        var self = this;
                        if(pricelist_id){
        	        		new Model("product.pricelist").get_func('price_get')([pricelist_id], product.id,1).pipe(
                            function(res){
                                if (res[pricelist_id]) {
                                    var pricelist_value = parseFloat(res[pricelist_id].toFixed(2));
                                    if (pricelist_value) {
                                        line.set_unit_price(pricelist_value);
                                        self.orderlines.add(line);
                                        self.select_orderline(self.get_last_orderline());
                                    }
                                    else {
                                    	self.orderlines.add(line);
                                    	self.select_orderline(self.get_last_orderline());
                                    }
                                }
                            });
        	        	} else {
        	            	this.orderlines.add(line);
        	            }
                    } else {
                    	this.orderlines.add(line);
                    }
                } else{
                    this.orderlines.add(line);
                }
    	    }
    	    this.select_orderline(this.get_last_orderline());
    	    $('.order-container').resizable();
            $('.order-container').mousedown(function() {
            	$('.order-container').css('z-index','1000');
            	$('.order-container').css('border', '4px solid #6d6b6b');
            	$('.order').css('max-width','100%');
            });
            $('.order-container').css('width',order_container_width+"px");
            $('.order-container').css('height',order_container_height+"px");
            $('.order-container').css('z-index','1000');
        	$('.order-container').css('border', '4px solid #6d6b6b');
        	$('.order').css('max-width','100%');
    	},
        select_orderline: function(line){
            var self = this;
            if(line){
                _super_order.select_orderline.call(this,line);
                if (self.pos.config.enable_show_cost_price){
                    if(self.pos.config.enable_pricelist){
                        if (line.get_unit_price() < line.product.standard_price){
                            self.pos.db.notification('info','Sale price is less then cost price!');
                            $('.pos .order .orderline.selected').css("background","#F57D7D");
                        }
                    } else{
                        if (line.price < line.product.standard_price){
                            self.pos.db.notification('info','Sale price is less then cost price!');
                            $('.pos .order .orderline.selected').css("background","#F57D7D");
                        }
                    }
                }
            } else{
                this.selected_orderline = undefined;
            }
         },
    	set_order_note: function(order_note) {
            this.order_note = order_note;
        },
        get_order_note: function() {
            return this.order_note;
        },
        
        set_order_stock_location: function(total_location){
            this.total_location = total_location;
        },
        get_order_stock_location: function() {
            return this.total_location;
        },
        set_total_qty: function(total_qty) {
            this.total_qty = total_qty;
        },
        get_total_qty: function() {
            return this.total_qty;
        },
        export_as_JSON: function() {
            var submitted_order = _super_order.export_as_JSON.call(this);
            var new_val = {
                order_note: this.get_order_note(),
                total_margin: this.get_total_margin(),
                updates_debt: this.updates_debt(),
                old_order_id: this.get_order_id(),
                sequence: this.get_sequence(),
                pos_reference: this.get_pos_reference(),
                set_as_draft: this.get_draft_order() || false,
            }
            $.extend(submitted_order, new_val);
            return submitted_order;
        },
        export_for_printing: function(){
            var orders = _super_order.export_for_printing.call(this);
            var client = this.get_client();
            var rounding = this.pos.currency.rounding;
            var new_val = {
                order_note: this.get_order_note() || '',
                debt_before: client ? round_pr(this.debt_before, rounding) : false,
                debt_after: client ? round_pr(this.debt_after, rounding) : false,
                debt_type: client ? client.debt_type : false,
                total_qty: this.get_total_qty() || false,
                no_of_item: this.get_orderlines().length,
                reprint_payment: this.get_journal() || false,
            	ref: this.get_pos_reference() || false,
            	date_order: this.get_date_order() || false,
            };
            $.extend(orders, new_val);
            return orders;
        },
        get_total_margin: function(){
			var total_margin = 0.00;
			_.each(this.get_orderlines(), function(line){
				total_margin += line.get_line_margin();
			})
			return total_margin;
		},
        margin_calculate: function(line){
            var margin = 0.00;
            margin = line.get_unit_price() - line.product.standard_price;
            line.set_line_margin(margin);
        },
        // Order History
        set_sequence:function(sequence){
        	this.set('sequence',sequence);
        },
        get_sequence:function(){
        	return this.get('sequence');
        },
        set_order_id: function(order_id){
            this.set('order_id', order_id);
        },
        get_order_id: function(){
            return this.get('order_id');
        },
        set_amount_paid: function(amount_paid) {
            this.set('amount_paid', amount_paid);
        },
        get_amount_paid: function() {
            return this.get('amount_paid');
        },
        set_amount_return: function(amount_return) {
            this.set('amount_return', amount_return);
        },
        get_amount_return: function() {
            return this.get('amount_return');
        },
        set_amount_tax: function(amount_tax) {
            this.set('amount_tax', amount_tax);
        },
        get_amount_tax: function() {
            return this.get('amount_tax');
        },
        set_amount_total: function(amount_total) {
            this.set('amount_total', amount_total);
        },
        get_amount_total: function() {
            return this.get('amount_total');
        },
        set_company_id: function(company_id) {
            this.set('company_id', company_id);
        },
        get_company_id: function() {
            return this.get('company_id');
        },
        set_date_order: function(date_order) {
            this.set('date_order', date_order);
        },
        get_date_order: function() {
            return this.get('date_order');
        },
        set_pos_reference: function(pos_reference) {
            this.set('pos_reference', pos_reference)
        },
        get_pos_reference: function() {
            return this.get('pos_reference')
        },
        set_user_name: function(user_id) {
            this.set('user_id', user_id);
        },
        get_user_name: function() {
            return this.get('user_id');
        },
        set_journal: function(statement_ids) {
            this.set('statement_ids', statement_ids)
        },
        get_journal: function() {
            return this.get('statement_ids');
        },
        get_change: function(paymentline) {
            if (!paymentline) {
            	if(this.get_total_paid() > 0){
            		var change = this.get_total_paid() - this.get_total_with_tax();
            	}else{
            		var change = this.get_amount_return();
            	}
            } else {
                var change = -this.get_total_with_tax();
                var lines  = this.pos.get_order().get_paymentlines();
                for (var i = 0; i < lines.length; i++) {
                    change += lines[i].get_amount();
                    if (lines[i] === paymentline) {
                        break;
                    }
                }
            }
            return round_pr(Math.max(0,change), this.pos.currency.rounding);
        },
        is_paid: function(){
            var is_paid = _super_order.is_paid.call(this);
            if(this.get_draft_order() && !is_paid){
                return !is_paid
            }
            return is_paid;
        },
        set_draft_order: function(val) {
            this.set('draft_order', val);
        },
        get_draft_order: function() {
            return this.get('draft_order');
        },
        set_edit_pos_order: function(edit_pos_order) {
            this.set('edit_pos_order', edit_pos_order);
        },
        get_edit_pos_order: function() {
            return this.get('edit_pos_order');
        },
    });

    var _super_paymentline = pos_model.Paymentline.prototype;
    pos_model.Paymentline = pos_model.Paymentline.extend({
        initialize: function(attributes, options) {
            _super_paymentline.initialize.call(this, attributes, options);
            this.set({
                'dummy_line': false,
            });
        },
        set_dummy_line: function(dummy_line) {
            this.set('dummy_line', dummy_line);
        },
        get_dummy_line: function() {
            return this.get('dummy_line');
        },
        export_as_JSON: function(){
            var lines = _super_paymentline.export_as_JSON.call(this);
            if(!this.get_dummy_line())
                return lines;
            return {};
        },
    });

	var _super_orderline = pos_model.Orderline.prototype;
    pos_model.Orderline = pos_model.Orderline.extend({
        initialize: function(attr,options){
            this.set({
                line_note : false,
                line_margin : 0.00
            })
            _super_orderline.initialize.call(this, attr, options);
        },
        set_line_note: function(line_note) {
            this.set('line_note', line_note);
        },
        get_line_note: function() {
            return this.get('line_note');
        },

        set_line_margin: function(margin){
            this.set('line_margin', margin);
        },
        get_line_margin: function(){
            return this.get('line_margin');
        },
        set_stock_location: function(location){
            this.set('location',location);
        },
        get_stock_location: function(){
            return this.get('location');
        },
        export_as_JSON: function() {
            var lines = _super_orderline.export_as_JSON.call(this);
            var new_attr = {
                line_note: this.get_line_note() || false,
                line_margin: this.get_line_margin() || false,
                paid_line: this.get_paid_amount_line() || false,
                line_stock_location: this.get_stock_location() ? this.get_stock_location()[0] : false,
            }
            $.extend(lines, new_attr);
            return lines;
        },
        export_for_printing: function() {
            var lines = _super_orderline.export_for_printing.call(this);
            var new_attr = {
                line_note: this.get_line_note(),
            }
            $.extend(lines, new_attr);
            return lines;
        },
        set_paid_amount_line: function(paid_amount_line){
        	this.set('paid_amount_line', paid_amount_line);
        },
        get_paid_amount_line: function() {
            return this.get('paid_amount_line');
        },
        set_quantity: function(quantity){
            _super_orderline.set_quantity.call(this, quantity);
            if(quantity !== 'remove'){
                this.calculate_line_margin();
            }
        },
        set_discount: function(discount){
            _super_orderline.set_discount.call(this, discount);
            this.calculate_line_margin();
        },
        set_unit_price: function(price){
            _super_orderline.set_unit_price.call(this, price);
            this.calculate_line_margin();
        },
        calculate_line_margin: function(){
            var total = 0.00;
            if (this.get_quantity() > 1){
                total = this.get_display_price() - (this.get_product().standard_price * this.get_quantity());
            } else if(this.get_quantity() == 1){
                total = this.get_unit_price() - (this.get_product().standard_price * this.get_quantity());
            }
            this.set_line_margin(total);
            this.trigger('change',this);
        }
    });
});